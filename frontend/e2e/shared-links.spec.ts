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
) {
  const token = (await (await request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const response = await request.fetch("/api/v1/" + path, {
    method: data ? "POST" : "GET",
    headers: { "X-CSRFToken": token },
    data,
  });
  expect(response.ok(), path).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}
async function login(
  context: BrowserContext,
  username: string,
  password: string,
) {
  await command(context.request, "auth/login", { username, password });
}

test("短链接：登录后返回、三类型/文档/迭代/附件直达、越权拒绝及旧链接兼容", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const admin = await browser.newContext({ baseURL });
  const recipient = await browser.newContext({ baseURL });
  const outsider = await browser.newContext({ baseURL });
  const memberNewPassword = `E2e-${randomUUID()}!`;
  try {
    await login(
      admin,
      "e2e-local",
      readFileSync(
        new URL("../../.local/e2e-password", import.meta.url),
        "utf8",
      ),
    );
    const suffix = Date.now();
    const project = await command(admin.request, "projects", {
      code: "LINK" + suffix,
      name: "分享链接验收",
    });
    const context = await command(admin.request, "workspace/context");
    const group = context.groups.find((g: any) => g.name === "普通用户");
    const position = context.positions.find((p: any) => p.enabled);
    const member = await command(admin.request, "users", {
      username: "link-member-" + suffix,
      display_name: "链接成员",
      group: group.id,
      position: position.id,
    });
    const stranger = await command(admin.request, "users", {
      username: "link-out-" + suffix,
      display_name: "链接外部人员",
      group: group.id,
      position: position.id,
    });
    await command(admin.request, `projects/${project.id}/members`, {
      user: member.id,
      role: "member",
    });
    const items = [];
    for (const type of ["requirement", "task", "bug"])
      items.push(
        await command(admin.request, `projects/${project.id}/work-items`, {
          type,
          title: "共享" + type,
        }),
      );
    const token = (await (await admin.request.get("/api/v1/auth/csrf")).json())
      .csrf_token;
    const documentResponse = await admin.request.post(
      `/api/v1/projects/${project.id}/documents/import`,
      {
        headers: { "X-CSRFToken": token },
        multipart: {
          file: {
            name: "共享文档.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("共享文档正文"),
          },
        },
      },
    );
    expect(documentResponse.ok()).toBeTruthy();
    const document = await documentResponse.json();
    const iteration = await command(
      admin.request,
      `projects/${project.id}/iterations`,
      {
        name: "共享迭代",
        owner: member.id,
        start_date: "2030-01-01",
        end_date: "2030-01-14",
      },
    );
    const attachmentResponse = await admin.request.post(
      `/api/v1/work-items/${items[1].id}/attachments`,
      {
        headers: { "X-CSRFToken": token },
        multipart: {
          file: {
            name: "共享附件.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("共享附件正文"),
          },
        },
      },
    );
    expect(attachmentResponse.ok()).toBeTruthy();
    const attachment = await attachmentResponse.json();
    const page = await recipient.newPage();
    await page.goto(items[0].web_url);
    await expect(page.getByLabel("登录账号", { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(items[0].web_url);
    await page.getByLabel("登录账号", { exact: true }).fill(member.username);
    await page
      .getByLabel("密码", { exact: true })
      .fill(member.temporary_password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page
      .getByLabel("新密码（至少10位）", { exact: true })
      .fill(memberNewPassword);
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: items[0].title, exact: true }),
    ).toBeVisible();
    for (const item of items) {
      await page.goto(item.web_url);
      await expect(
        page.getByRole("heading", { name: item.title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "复制链接", exact: true }),
      ).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(item.web_url);
      expect(new URL(page.url()).search).toBe("");
      await page.reload();
      await expect(
        page.getByRole("heading", { name: item.title, exact: true }),
      ).toBeVisible();
    }
    await page.goto(
      `/?view=items&project=${project.id}&type=task&item_mode=detail&item_type=task&item_id=${items[1].id}&q=private-filter`,
    );
    await expect(
      page.getByRole("heading", { name: items[1].title, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new URL(items[1].web_url, baseURL).href);
    await page.goto(document.web_url);
    await expect(
      page.getByRole("heading", { name: document.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".unified-file-preview")).toBeVisible();
    await page.goto(iteration.web_url);
    await expect(page.getByRole("dialog")).toContainText("共享迭代");
    await page.goto(`/attachments/${attachment.id}`);
    await expect(
      page.getByRole("heading", {
        name: attachment.original_name,
        exact: true,
      }),
    ).toBeVisible();
    await login(outsider, stranger.username, stranger.temporary_password);
    await command(outsider.request, "auth/change-password", {
      password: `E2e-${randomUUID()}!`,
    });
    const denied = await outsider.newPage();
    await denied.goto(items[0].web_url);
    await expect(
      denied.getByRole("heading", { name: items[0].title, exact: true }),
    ).toHaveCount(0);
    await expect(denied.locator(".ant-alert")).toContainText(/已删除|无权访问/);
    // Real session revocation exercises the UI expiry path without waiting two hours.
    await page.goto(items[1].web_url);
    await expect(
      page.getByRole("heading", { name: items[1].title, exact: true }),
    ).toBeVisible();
    await command(recipient.request, "auth/logout", {});
    await page
      .evaluate(() => window.dispatchEvent(new Event("focus")))
      .catch((error) => {
        if (!error.message.includes("Execution context was destroyed"))
          throw error;
      });
    await expect(page.getByLabel("登录账号", { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(items[1].web_url);
    await page.getByLabel("登录账号", { exact: true }).fill(member.username);
    await page
      .getByLabel("密码", { exact: true })
      .fill(memberNewPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: items[1].title, exact: true }),
    ).toBeVisible();
  } finally {
    await admin.close();
    await recipient.close();
    await outsider.close();
  }
});

test("登录失效后恢复未提交的编辑内容及附件，保存后清理恢复草稿", async ({
  page,
}) => {
  const password = readFileSync(
    new URL("../../.local/e2e-password", import.meta.url),
    "utf8",
  );
  await login(page.context(), "e2e-local", password);
  const project = await command(page.request, "projects", {
    code: "REC" + Date.now(),
    name: "过期恢复验收",
  });
  const item = await command(
    page.request,
    `projects/${project.id}/work-items`,
    { type: "task", title: "过期前原始标题" },
  );
  await page.goto(item.web_url + "/edit");
  await page.getByLabel("标题", { exact: true }).fill("会话恢复后的编辑标题");
  await page.locator(".pending-attachments input[type=file]").setInputFiles({
    name: "恢复附件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("draft file"),
  });
  await expect(page.locator(".pending-file-list")).toContainText(
    "恢复附件.txt",
  );
  await command(page.request, "auth/logout", {});
  await page
    .evaluate(() => window.dispatchEvent(new Event("focus")))
    .catch((error) => {
      if (!error.message.includes("Execution context was destroyed"))
        throw error;
    });
  await expect(page.getByLabel("登录账号", { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(item.web_url + "/edit");
  await page.getByLabel("登录账号", { exact: true }).fill("e2e-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "会话恢复后的编辑标题",
  );
  await expect(page.locator(".pending-file-list")).toContainText(
    "恢复附件.txt",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "会话恢复后的编辑标题", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "恢复附件.txt", exact: true }),
  ).toBeVisible();
  await page.goto(item.web_url + "/edit");
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "会话恢复后的编辑标题",
  );
  await expect(
    page.locator(".pending-file-list .pending-attachment-file"),
  ).toHaveCount(0);
});
