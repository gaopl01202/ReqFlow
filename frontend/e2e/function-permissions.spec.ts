import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

test("菜单功能授权：配置矩阵、委派用户编辑、按钮撤权与接口拒绝", async ({
  page,
  browser,
  baseURL,
}) => {
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
  await page.goto("/?view=user-groups");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByText("返回用户组", { exact: true })).toHaveCount(0);
  await expect(page.getByText("菜单下的功能权限", { exact: true })).toHaveCount(
    0,
  );
  const suffix = Date.now().toString();
  const name = "授权验收" + suffix;
  await page.getByLabel("用户组名称", { exact: true }).fill(name);
  const row = page.locator(".permission-matrix-row").filter({
    has: page.getByRole("checkbox", { name: "用户管理", exact: true }),
  });
  await expect(
    row.getByRole("checkbox", { name: "编辑用户", exact: true }),
  ).toBeDisabled();
  await row.getByRole("checkbox", { name: "用户管理", exact: true }).check();
  // Controlled checkbox state settles after the form/watch update.
  for (const label of ["编辑用户", "新建用户"]) {
    const checkbox = row.getByRole("checkbox", { name: label, exact: true });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  }
  await page.screenshot({
    path: "../.local/ui73-permission-matrix.png",
    animations: "disabled",
  });
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/user-groups") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const group = await (await saved).json();
  expect(group.action_permissions.sort()).toEqual([
    "users:create",
    "users:edit",
  ]);
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": csrf };
  const context = await (
    await page.request.get("/api/v1/workspace/context")
  ).json();
  const created = await page.request.post("/api/v1/users", {
    headers,
    data: {
      username: "ui73-" + suffix,
      display_name: "委派用户" + suffix,
      group: group.id,
      position: context.positions.find((p: any) => p.enabled).id,
    },
  });
  expect(created.ok()).toBeTruthy();
  const user = await created.json();
  const delegated = await browser.newContext({ baseURL });
  try {
    const token = (
      await (await delegated.request.get("/api/v1/auth/csrf")).json()
    ).csrf_token;
    expect(
      (
        await delegated.request.post("/api/v1/auth/login", {
          headers: { "X-CSRFToken": token },
          data: { username: user.username, password: user.temporary_password },
        })
      ).ok(),
    ).toBeTruthy();
    const rotated = (
      await (await delegated.request.get("/api/v1/auth/csrf")).json()
    ).csrf_token;
    expect(
      (
        await delegated.request.post("/api/v1/auth/change-password", {
          headers: { "X-CSRFToken": rotated },
          data: { password: `E2e-${randomUUID()}!` },
        })
      ).ok(),
    ).toBeTruthy();
    const view = await delegated.newPage();
    await view.goto("/?view=users&q=" + encodeURIComponent(user.username));
    await expect(
      view.getByRole("button", { name: "新建", exact: true }),
    ).toBeVisible();
    const ownRow = view.getByRole("row").filter({ hasText: user.username });
    await expect(
      ownRow.getByRole("button", { name: "编辑", exact: true }),
    ).toBeVisible();
    await expect(
      ownRow.getByRole("button", { name: "停用", exact: true }),
    ).toHaveCount(0);
    await expect(
      ownRow.getByRole("button", { name: "重置密码", exact: true }),
    ).toHaveCount(0);
    await ownRow.getByRole("button", { name: "编辑", exact: true }).click();
    await view
      .getByRole("dialog")
      .getByLabel("姓名", { exact: true })
      .fill("已授权修改" + suffix);
    await view
      .getByRole("dialog")
      .getByRole("button", { name: "确定", exact: true })
      .click();
    await expect(ownRow).toContainText("已授权修改" + suffix);
    const fresh = await (
      await page.request.get(`/api/v1/user-groups/${group.id}`)
    ).json();
    expect(
      (
        await page.request.patch(`/api/v1/user-groups/${group.id}`, {
          headers,
          data: { version: fresh.version, action_permissions: [] },
        })
      ).ok(),
    ).toBeTruthy();
    await view.reload();
    await expect(ownRow).toBeVisible();
    await expect(
      ownRow.getByRole("button", { name: "编辑", exact: true }),
    ).toHaveCount(0);
    await expect(
      view.getByRole("button", { name: "新建", exact: true }),
    ).toHaveCount(0);
    const nextCsrf = (
      await (await delegated.request.get("/api/v1/auth/csrf")).json()
    ).csrf_token;
    const denied = await delegated.request.patch(`/api/v1/users/${user.id}`, {
      headers: { "X-CSRFToken": nextCsrf },
      data: { version: 2, display_name: "不应保存" },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await delegated.close();
  }
});
