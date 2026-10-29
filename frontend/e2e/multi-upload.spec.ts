import { followWorkPage } from "./work-page-navigation";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function api(page: Page, path: string, data?: unknown) {
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const r = await page.request.fetch("/api/v1/" + path, {
    method: data ? "POST" : "GET",
    data,
    headers: { "X-CSRFToken": csrf },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test("三类工作项多附件：新建/编辑过滤超限、详情单文件失败不阻断、批次不重复", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: true }).fill("e2e-local");
  await page
    .getByLabel("密码", { exact: true })
    .fill(
      readFileSync(
        new URL("../../.local/e2e-password", import.meta.url),
        "utf8",
      ),
    );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("最近访问项目", { exact: true })).toBeVisible();
  const user = await api(page, "auth/me");
  const project = await api(page, "projects", {
    name: "多附件验收",
    code: "MULTI" + Date.now(),
  });
  let writes = 0;
  page.on("request", (request) => {
    if (
      ["POST", "PATCH", "DELETE"].includes(request.method()) &&
      /\/work-items(?:\/[0-9a-f-]+(?:\/attachments)?)?$/.test(
        new URL(request.url()).pathname,
      )
    )
      writes++;
  });
  const oversized = Buffer.alloc(user.attachment_max_bytes + 1);
  const file = (name: string, large = false) => ({
    name,
    mimeType: "text/plain",
    buffer: large ? oversized : Buffer.from("附件正文"),
  });
  for (const [type, label] of [
    ["requirement", "需求"],
    ["task", "任务"],
    ["bug", "缺陷"],
  ]) {
    await page.goto(`/?view=items&project=${project.id}&type=${type}`);
    await followWorkPage(
      page,
      page.getByRole("link", { name: "新建" + label, exact: true }),
    );
    const work = page.locator(".work-page");
    const beforeStaging = writes;
    await work.getByLabel("标题", { exact: true }).fill(label + "多附件");
    const staged = work.locator(".pending-attachments input[type=file]");
    await expect(staged).toHaveAttribute("multiple", "");
    await staged.setInputFiles([
      file(type + "-新建A.txt"),
      file(type + "-新建超限.txt", true),
      file(type + "-新建B.txt"),
    ]);
    await expect(
      work.locator(".pending-attachments .pending-attachment-file"),
    ).toHaveCount(2);
    await page.mouse.move(0, 0);
    const stagedRow = work.locator(".pending-attachment-file").first();
    await expect(stagedRow.locator(".attachment-file-icon")).toBeVisible();
    await expect(stagedRow.locator(".attachment-row-actions")).toHaveCSS(
      "opacity",
      "0",
    );
    await stagedRow.hover();
    await expect(stagedRow.locator(".attachment-row-actions")).toHaveCSS(
      "opacity",
      "1",
    );
    await stagedRow
      .getByRole("button", {
        name: "移除待上传附件 " + type + "-新建A.txt",
        exact: true,
      })
      .click();
    await expect(work.locator(".pending-attachment-file")).toHaveCount(1);
    await staged.setInputFiles(file(type + "-新建A.txt"));
    await expect(work.locator(".pending-attachment-file")).toHaveCount(2);
    await expect(
      work.locator(
        ".pending-file-list .attachment-author, .pending-file-list .attachment-date, .pending-file-list a",
      ),
    ).toHaveCount(0);
    expect(writes).toBe(beforeStaging);
    if (type === "requirement")
      await page.screenshot({
        path: "../.local/ui80-create.png",
        animations: "disabled",
      });
    const tags = work.locator(".pending-file-list .pending-attachment-file");
    const first = (await tags.nth(0).boundingBox())!;
    const second = (await tags.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(second.x).toBe(first.x);
    await expect(
      page.getByText(new RegExp(type + "-新建超限.txt：超过")),
    ).toBeVisible();
    await work
      .getByRole("button", { name: /^(创建|保存)$/, exact: true })
      .click();
    await expect(
      work.getByRole("heading", { name: label + "多附件", exact: true }),
    ).toBeVisible();
    const id = (
      await api(
        page,
        `links/${project.code}/${type}/${new URL(page.url()).pathname.split("/").pop()}`,
      )
    ).id;
    let list = await api(page, `work-items/${id}/attachments`);
    expect(list.items.map((a: any) => a.original_name).sort()).toEqual(
      [type + "-新建A.txt", type + "-新建B.txt"].sort(),
    );
    const detailRow = work.locator(".attachment-file").first();
    await page.mouse.move(0, 0);
    await expect(detailRow.locator(".attachment-row-actions")).toHaveCSS(
      "opacity",
      "0",
    );
    await detailRow.hover();
    await expect(detailRow.locator(".attachment-row-actions")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(
      work.locator(
        ".detail-attachments button[aria-label=添加附件] .anticon-plus",
      ),
    ).toBeVisible();
    if (type === "requirement")
      await page.screenshot({
        path: "../.local/ui80-detail.png",
        animations: "disabled",
      });
    await work.getByRole("button", { name: "编辑", exact: true }).click();
    const beforeEditingFiles = writes;
    await work
      .locator(".pending-attachments input[type=file]")
      .setInputFiles([
        file(type + "-编辑A.txt"),
        file(type + "-编辑超限.txt", true),
        file(type + "-编辑B.txt"),
      ]);
    await expect(
      work.locator(".pending-attachments .pending-attachment-file"),
    ).toHaveCount(2);
    expect(writes).toBe(beforeEditingFiles);
    await expect(
      page.getByText(new RegExp(type + "-编辑超限.txt：超过")),
    ).toBeVisible();
    await work
      .getByRole("button", { name: /^(创建|保存)$/, exact: true })
      .click();
    await expect(
      work.getByRole("heading", { name: label + "多附件", exact: true }),
    ).toBeVisible();
    list = await api(page, `work-items/${id}/attachments`);
    expect(list.items).toHaveLength(4);
    let posted = 0;
    await page.route(
      `**/api/v1/work-items/${id}/attachments`,
      async (route) => {
        if (route.request().method() === "POST") {
          posted++;
          expect(route.request().postDataBuffer()!.byteLength).toBeLessThan(
            10000,
          );
          if (posted === 2) {
            await route.fulfill({
              status: 422,
              json: {
                code: "VALIDATION_ERROR",
                message: "模拟单文件上传失败",
                fields: {},
              },
            });
            return;
          }
        }
        await route.continue();
      },
    );
    await work
      .getByLabel("流转评论", { exact: true })
      .fill("上传不能清空未提交的评论");
    const picker = work.locator(".detail-attachments input[type=file]");
    await expect(picker).toHaveAttribute("multiple", "");
    await picker.setInputFiles([
      file(type + "-详情A.txt"),
      file(type + "-详情超限.txt", true),
      file(type + "-详情失败.txt"),
      file(type + "-详情C.txt"),
    ]);
    await expect(
      page.getByText(new RegExp(type + "-详情超限.txt：超过")),
    ).toBeVisible();
    await expect(
      work.getByRole("link", { name: type + "-详情A.txt", exact: true }),
    ).toBeVisible();
    await expect(
      work.getByRole("link", { name: type + "-详情C.txt", exact: true }),
    ).toBeVisible();
    expect(posted).toBe(3);
    list = await api(page, `work-items/${id}/attachments`);
    expect(list.items).toHaveLength(6);
    expect(
      list.items.every(
        (a: any) =>
          !a.original_name.includes("超限") &&
          !a.original_name.includes("失败"),
      ),
    ).toBeTruthy();
    await expect(work.getByLabel("流转评论", { exact: true })).toContainText(
      "上传不能清空未提交的评论",
    );
    await page.reload();
    await expect(
      work.getByRole("link", { name: type + "-详情C.txt", exact: true }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});
