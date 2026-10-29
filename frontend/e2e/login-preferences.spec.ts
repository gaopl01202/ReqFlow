import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("UI-64 强制改密不输入旧密码，恢复当前账号最近项目", async ({ page }) => {
  const newPassword = `E2e-${randomUUID()}!`;
  const project = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "最近访问项目验证",
    status: "active",
    current_role: "admin",
  };
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "preference",
    display_name: "测试用户",
    is_superuser: true,
    must_change_password: true,
    permissions: [],
    attachment_extensions: [],
  };
  await page.addInitScript(
    ({ id, project }) => {
      localStorage.setItem(
        "reqflow:recent:" + id,
        JSON.stringify(["33333333-3333-4333-8333-333333333333", project]),
      );
    },
    { id: user.id, project: project.id },
  );
  let changed = false;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: user });
    if (path.endsWith("/auth/change-password")) {
      const data = route.request().postDataJSON();
      expect(data.old_password).toBeUndefined();
      expect(data.password).toBe(newPassword);
      changed = true;
      user.must_change_password = false;
      return route.fulfill({ json: user });
    }
    if (path.endsWith("/33333333-3333-4333-8333-333333333333"))
      return route.fulfill({ status: 404, json: { message: "无项目权限" } });
    if (path.endsWith("/projects/" + project.id))
      return route.fulfill({ json: project });
    if (path.endsWith("/projects"))
      return route.fulfill({ json: { items: [project], total: 1 } });
    return route.fulfill({
      json: {
        items: [],
        total: 0,
        members: [],
        iterations: [],
        categories: [],
        dictionaries: [],
        workflow: {},
        project,
      },
    });
  });
  await page.goto("/");
  await expect(page.getByText("请设置新密码", { exact: true })).toBeVisible();
  await expect(page.getByLabel("临时密码", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("新密码（至少10位）", { exact: true })
    .fill(newPassword);
  await page.getByRole("button", { name: "修改密码", exact: true }).click();
  await expect.poll(() => changed).toBeTruthy();
  await expect(page.locator(".project-switcher")).toContainText(project.name);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("project"))
    .toBe(project.id);
  await page.reload();
  await expect(page.locator(".project-switcher")).toContainText(project.name);
});
