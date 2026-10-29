import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

async function command(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = "POST",
) {
  const token = (await (await request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const response = await request.fetch("/api/v1/" + path, {
    method,
    headers: { "X-CSRFToken": token },
    data,
  });
  expect(response.ok(), path + " " + (await response.text())).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

test("三类型更多菜单：复制预填/取消/刷新/独立图片/正常创建与删除权限", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const admin = await browser.newContext({ baseURL });
  const writer = await browser.newContext({ baseURL });
  const reader = await browser.newContext({ baseURL });
  try {
    await command(admin.request, "auth/login", {
      username: "e2e-local",
      password: readFileSync(
        new URL("../../.local/e2e-password", import.meta.url),
        "utf8",
      ),
    });
    const suffix = Date.now();
    const project = await command(admin.request, "projects", {
      code: "COPY" + suffix,
      name: "复制验收",
    });
    const meta = await command(
      admin.request,
      "workspace/context",
      undefined,
      "GET",
    );
    const group = meta.groups.find((row: any) => row.name === "普通用户");
    let copier: any;
    for (const [context, role] of [
      [writer, "member"],
      [reader, "readonly"],
    ] as const) {
      const user = await command(admin.request, "users", {
        username: "copy-" + role + suffix,
        display_name: role === "member" ? "复制成员" : "复制只读",
        group: group.id,
        position: meta.positions.find((row: any) => row.enabled).id,
      });
      await command(admin.request, `projects/${project.id}/members`, {
        user: user.id,
        role,
      });
      await command(context.request, "auth/login", {
        username: user.username,
        password: user.temporary_password,
      });
      await command(context.request, "auth/change-password", {
        password: `E2e-${randomUUID()}!`,
      });
      if (role === "member") copier = user;
    }
    const myself = await command(admin.request, "auth/me", undefined, "GET");
    const category = await command(
      admin.request,
      `projects/${project.id}/categories`,
      { name: "复制分类" },
    );
    const priority = await command(
      admin.request,
      `projects/${project.id}/dictionaries`,
      { kind: "priority", name: "复制优先级", color: "purple" },
    );
    const workflow = (
      await command(
        admin.request,
        `projects/${project.id}/workflow`,
        undefined,
        "GET",
      )
    ).workflow;
    const page = await writer.newPage();
    const readonlyPage = await reader.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [kind, label] of [
      ["requirement", "需求"],
      ["task", "任务"],
      ["bug", "缺陷"],
    ]) {
      const imageToken = "reqflow-upload:" + randomUUID();
      const fileToken = "reqflow-upload:" + randomUUID();
      const csrf = (await (await admin.request.get("/api/v1/auth/csrf")).json())
        .csrf_token;
      const multipart = new FormData();
      multipart.append(
        "payload",
        JSON.stringify({
          type: kind,
          title: "来源" + label,
          description: `来源描述 **重点**\n\n![图片](${imageToken})\n\n![再次使用](${imageToken})`,
          category: category.id,
          priority: priority.id,
          assignee: myself.id,
          upload_tokens: [imageToken, fileToken],
          ...(kind === "requirement"
            ? { proposer: "客户甲", source: "internal" }
            : {}),
        }),
      );
      multipart.append(
        "files",
        new Blob(
          [
            readFileSync(
              new URL(
                "./fixtures/import-documents/sample.png",
                import.meta.url,
              ),
            ),
          ],
          { type: "image/png" },
        ),
        "description.png",
      );
      multipart.append(
        "files",
        new Blob(["不要复制"], { type: "text/plain" }),
        "独立附件.txt",
      );
      const response = await admin.request.post(
        `/api/v1/projects/${project.id}/work-items`,
        { headers: { "X-CSRFToken": csrf }, multipart },
      );
      expect(response.ok(), await response.text()).toBeTruthy();
      let source = await response.json();
      const initialStatus = source.status;
      const edge = workflow[kind].transitions.find(
        (row: any) => row.from === source.status && row.enabled,
      );
      source = await command(
        admin.request,
        `work-items/${source.id}/transition`,
        {
          version: source.version,
          target_status: edge.to,
          handlers: [myself.id],
        },
      );
      await command(admin.request, `work-items/${source.id}/comments`, {
        body: "来源评论",
      });
      await readonlyPage.goto(source.web_url);
      await expect(
        readonlyPage.getByRole("heading", { name: source.title, exact: true }),
      ).toBeVisible();
      await expect(
        readonlyPage.getByRole("button", { name: "更多", exact: true }),
      ).toHaveCount(0);
      await page.goto(source.web_url);
      await expect(
        page.getByRole("heading", { name: source.title, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .locator(".item-titlebar")
          .getByRole("button", { name: "删除", exact: true }),
      ).toHaveCount(0);
      const before = await command(
        writer.request,
        `projects/${project.id}/work-items?type=${kind}`,
        undefined,
        "GET",
      );
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "复制", exact: true }),
      ).toBeVisible();
      if (kind === "requirement")
        await page.screenshot({ path: "../.local/ui79-more-menu.png" });
      await expect(
        page.getByRole("menuitem", { name: "删除", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("menuitem", { name: "复制", exact: true }).click();
      await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
        source.title,
      );
      await expect(page).toHaveURL(new RegExp("copy_from=" + source.id));
      await expect(page.locator(".pending-file-name")).toHaveCount(1);
      expect(
        (
          await command(
            writer.request,
            `projects/${project.id}/work-items?type=${kind}`,
            undefined,
            "GET",
          )
        ).total,
      ).toBe(before.total);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      expect(
        (
          await command(
            writer.request,
            `projects/${project.id}/work-items?type=${kind}`,
            undefined,
            "GET",
          )
        ).total,
      ).toBe(before.total);
      await page.goto(source.web_url);
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: "复制", exact: true }).click();
      await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
        source.title,
      );
      await page.reload();
      await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
        source.title,
      );
      await expect(page.getByLabel("描述", { exact: true })).toContainText(
        "来源描述",
      );
      await expect(page.locator(".pending-file-name")).toHaveCount(1);
      await page.getByLabel("标题", { exact: true }).fill("副本" + label);
      await page.getByRole("button", { name: "创建", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "副本" + label, exact: true }),
      ).toBeVisible();
      const target = await command(
        writer.request,
        `links/${project.code}/${kind}/${new URL(page.url()).pathname.split("/").pop()}`,
        undefined,
        "GET",
      );
      const copied = await command(
        writer.request,
        `work-items/${target.id}`,
        undefined,
        "GET",
      );
      expect(copied.id).not.toBe(source.id);
      expect(copied.number).not.toBe(source.number);
      expect(copied.status).toBe(initialStatus);
      expect(copied.created_by).toBe(copier.id);
      expect(copied.category).toBe(category.id);
      expect(copied.priority).toBe(priority.id);
      expect(copied.description).toContain("来源描述");
      expect(copied.description).not.toContain(
        source.description.match(/attachments\/([0-9a-f-]+)/)[1],
      );
      expect(
        (
          await command(
            writer.request,
            `work-items/${copied.id}/comments`,
            undefined,
            "GET",
          )
        ).total,
      ).toBe(0);
      expect(
        (
          await command(
            writer.request,
            `work-items/${copied.id}/attachments`,
            undefined,
            "GET",
          )
        ).total,
      ).toBe(0);
      const image = page.locator(".detail-description img").first();
      await expect(image).toBeVisible();
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: "删除", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      expect(
        (
          await command(
            writer.request,
            `work-items/${copied.id}`,
            undefined,
            "GET",
          )
        ).id,
      ).toBe(copied.id);
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: "删除", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await expect
        .poll(async () =>
          (
            await writer.request.get(`/api/v1/work-items/${copied.id}`)
          ).status(),
        )
        .toBe(404);
      const unchanged = await command(
        writer.request,
        `work-items/${source.id}`,
        undefined,
        "GET",
      );
      expect(unchanged.title).toBe(source.title);
      expect(unchanged.status).toBe(source.status);
      await page.goto(source.web_url);
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: "复制", exact: true }).click();
      await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
        source.title,
      );
      await page
        .getByRole("button", { name: "提交并继续创建", exact: true })
        .click();
      await expect(page.getByLabel("标题", { exact: true })).toHaveValue("");
      await expect(page).not.toHaveURL(/copy_from=/);
      await expect(page.locator(".pending-file-name")).toHaveCount(0);
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
    expect(errors).toEqual([]);
  } finally {
    await admin.close();
    await writer.close();
    await reader.close();
  }
});
