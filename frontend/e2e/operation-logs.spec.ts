import { test, expect, type APIRequestContext } from "@playwright/test";
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
  expect(response.ok(), path).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

test("运行日志：中文摘要、点击搜索、只读菜单授权与即时撤权", async ({
  browser,
  baseURL,
}) => {
  const admin = await browser.newContext({ baseURL });
  const viewer = await browser.newContext({ baseURL });
  try {
    await command(admin.request, "auth/login", {
      username: "e2e-local",
      password: readFileSync(
        new URL("../../.local/e2e-password", import.meta.url),
        "utf8",
      ),
    });
    const suffix = Date.now();
    const group = await command(admin.request, "user-groups", {
      name: "日志只读" + suffix,
      menu_permissions: ["operation-logs"],
      action_permissions: [],
    });
    const context = await command(
      admin.request,
      "workspace/context",
      undefined,
      "GET",
    );
    const user = await command(admin.request, "users", {
      username: "log-view-" + suffix,
      display_name: "日志查看者",
      group: group.id,
      position: context.positions.find((row: any) => row.enabled).id,
    });
    await command(viewer.request, "auth/login", {
      username: user.username,
      password: user.temporary_password,
    });
    await command(viewer.request, "auth/change-password", {
      password: `E2e-${randomUUID()}!`,
    });
    const project = await command(admin.request, "projects", {
      code: "LOG" + suffix,
      name: "运行日志验收",
    });
    const item = await command(
      admin.request,
      `projects/${project.id}/work-items`,
      {
        type: "requirement",
        title: "日志不应包含这个标题",
        description: "也不能包含描述正文",
      },
    );
    const page = await viewer.newPage();
    await page.goto("/?view=operation-logs");
    await expect(
      page
        .locator(".ant-card-head-title")
        .getByText("运行日志", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "对象ID", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "操作", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新建", exact: true }),
    ).toHaveCount(0);
    let searches = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/operation-logs?")) searches++;
    });
    await page.getByRole("textbox", { name: "搜索运行日志" }).fill(item.id);
    await page.waitForTimeout(250);
    expect(searches).toBe(0);
    const searched = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/operation-logs?") &&
        response.url().includes(item.id),
    );
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const result = await (await searched).json();
    expect(result.items.length).toBeGreaterThan(0);
    await expect(
      page.locator("tbody").getByText(item.id, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.locator("tbody").getByText("需求", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("日志不应包含这个标题", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "../.local/ui75-operation-logs.png",
      fullPage: true,
    });
    await command(
      admin.request,
      `user-groups/${group.id}`,
      { version: group.version, menu_permissions: [], action_permissions: [] },
      "PATCH",
    );
    expect((await viewer.request.get("/api/v1/operation-logs")).status()).toBe(
      403,
    );
    await page.reload();
    await expect(
      page.getByText("没有此页面的菜单权限，请从左侧选择可访问页面。", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await admin.close();
    await viewer.close();
  }
});
