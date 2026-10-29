import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

test("UI-58：用户组大页面、菜单隔离与工作台数字跳转", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
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
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  async function call(path: string, data?: any, method = "POST") {
    const response = await page.request.fetch(`/api/v1/${path}`, {
      method: data ? method : "GET",
      headers: { "X-CSRFToken": csrf },
      data,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const suffix = Date.now();
  const me = await call("auth/me");
  const project = await call("projects", {
    name: "工作台入口验收",
    code: "HOME" + suffix,
  });
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const yesterday = new Date(
    new Date(today + "T12:00:00+08:00").getTime() - 86400000,
  ).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  for (const [title, due] of [
    ["今日到期验收", today],
    ["逾期验收", yesterday],
  ])
    await call(`projects/${project.id}/work-items`, {
      type: "task",
      title,
      due_date: due,
      handlers: [me.id],
    });
  await page.reload();
  const dashboard = await call("me/dashboard");
  for (const [label, scope, key] of [
    ["未完成事项", "all", "unfinished"],
    ["今日到期", "today", "due_today"],
    ["逾期事项", "overdue", "overdue"],
  ]) {
    await page
      .getByRole("button", { name: `${label} ${dashboard[key]}`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`todo_scope=${scope}`));
    await expect(page.locator(".ant-table-pagination")).toContainText(
      `总共 ${dashboard[key]} 条`,
    );
  }
  await page
    .getByRole("button", {
      name: `参与项目 ${dashboard.projects}`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/view=projects/);
  await page.goto("/?view=home");
  await expect(page.getByText("项目进展", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `未完成事项 ${dashboard.unfinished}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "../.local/ui58-workbench.png",
    animations: "disabled",
  });
  await page
    .getByRole("menuitem", { name: "用户组与权限", exact: true })
    .click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page).toHaveURL(/view=group-editor/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByLabel("用户组名称", { exact: true })
    .fill("菜单隔离" + suffix);
  const allMenus = page.getByRole("checkbox", {
    name: "全部菜单",
    exact: true,
  });
  await allMenus.click();
  await expect(allMenus).toBeChecked();
  await allMenus.click();
  await expect(allMenus).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "工作台", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "工作台", exact: true }).check();
  await page.getByRole("checkbox", { name: "项目文档", exact: true }).check();
  await expect(page.locator(".permission-matrix")).toBeVisible();
  const footer = await page.locator(".group-editor-footer").boundingBox();
  expect(footer!.y + footer!.height).toBeCloseTo(
    page.viewportSize()!.height,
    0,
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/view=user-groups/);
  const groups = await call(
    "user-groups?q=" + encodeURIComponent("菜单隔离" + suffix),
  );
  const group = groups.items[0];
  expect(group.menu_permissions.sort()).toEqual(["documents", "home"]);
  expect(group.permissions).toContain("edit_items");
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: group.name, exact: true }) })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.reload();
  await expect(page.getByLabel("用户组名称", { exact: true })).toHaveValue(
    group.name,
  );
  await expect(
    page.getByRole("checkbox", { name: "项目文档", exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: "../.local/ui58-group-editor.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const positions = await call("positions?page_size=100");
  const newUser = await call("users", {
    username: "menu" + suffix,
    display_name: "菜单验收成员",
    position: positions.items.find((item: any) => item.enabled).id,
    group: group.id,
  });
  await call(`projects/${project.id}/members`, {
    user: newUser.id,
    role: "member",
  });
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173",
  });
  try {
    let token = (await (await context.request.get("/api/v1/auth/csrf")).json())
      .csrf_token;
    expect(
      (
        await context.request.post("/api/v1/auth/login", {
          headers: { "X-CSRFToken": token },
          data: {
            username: newUser.username,
            password: newUser.temporary_password,
          },
        })
      ).ok(),
    ).toBeTruthy();
    token = (await (await context.request.get("/api/v1/auth/csrf")).json())
      .csrf_token;
    expect(
      (
        await context.request.post("/api/v1/auth/change-password", {
          headers: { "X-CSRFToken": token },
          data: {
            old_password: newUser.temporary_password,
            password: `E2e-${randomUUID()}!`,
          },
        })
      ).ok(),
    ).toBeTruthy();
    const memberPage = await context.newPage();
    await memberPage.goto(`/?view=documents&project=${project.id}`);
    await expect(
      memberPage.getByRole("menuitem", { name: "项目文档", exact: true }),
    ).toBeVisible();
    for (const name of ["工作项", "统计报表", "用户管理"])
      await expect(
        memberPage.getByRole("menuitem", { name, exact: true }),
      ).toHaveCount(0);
    expect(
      (
        await context.request.get(`/api/v1/projects/${project.id}/work-items`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.get(`/api/v1/projects/${project.id}/context`)
      ).ok(),
    ).toBeTruthy();
    await memberPage.goto(`/?view=reports&project=${project.id}`);
    await expect(
      memberPage.getByText("没有此页面的菜单权限，请从左侧选择可访问页面。", {
        exact: true,
      }),
    ).toBeVisible();
    const updated = await call(
      `user-groups/${group.id}`,
      { version: group.version, menu_permissions: ["home", "items"] },
      "PATCH",
    );
    expect(updated.permissions).toEqual(group.permissions);
    await memberPage.reload();
    await expect(
      memberPage.getByRole("menuitem", { name: "工作项", exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("menuitem", { name: "项目文档", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await context.request.get(`/api/v1/projects/${project.id}/documents`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.get(`/api/v1/projects/${project.id}/work-items`)
      ).ok(),
    ).toBeTruthy();
  } finally {
    await context.close();
  }
});
