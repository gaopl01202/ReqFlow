import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("UI-57：报表图表与筛选导出、分组权限、列表确认启停", async ({ page }) => {
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
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const suffix = Date.now();
  const position = await call("positions", { name: "启停职务" + suffix });
  await page.goto("/?view=positions");
  const row = (name: string) =>
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
  await page.getByPlaceholder("搜索职务名称").fill(position.name);
  await page.getByPlaceholder("搜索职务名称").press("Enter");
  await row(position.name)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await row(position.name)
    .getByRole("button", { name: "停用", exact: true })
    .click();
  await page
    .locator(".ant-popconfirm")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(
    row(position.name).getByRole("button", { name: "停用", exact: true }),
  ).toBeVisible();
  await row(position.name)
    .getByRole("button", { name: "停用", exact: true })
    .click();
  await page
    .locator(".ant-popconfirm")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(
    row(position.name).getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  await row(position.name)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await dialog.getByLabel("名称", { exact: true }).fill(position.name + "改");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(
    row(position.name + "改").getByRole("button", {
      name: "启用",
      exact: true,
    }),
  ).toBeVisible();
  await row(position.name + "改")
    .getByRole("button", { name: "启用", exact: true })
    .click();
  await page
    .locator(".ant-popconfirm")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(
    row(position.name + "改").getByRole("button", {
      name: "停用",
      exact: true,
    }),
  ).toBeVisible();

  await page.goto("/?view=user-groups");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page).toHaveURL(/view=group-editor/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByLabel("用户组名称", { exact: true })
    .fill("权限验收" + suffix);
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
  await page.getByRole("checkbox", { name: "统计报表", exact: true }).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await row("权限验收" + suffix)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "工作台", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "统计报表", exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: "../.local/ui58-group-editor.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();

  const project = await call("projects", {
    name: "报表图表验收",
    code: "REPORT" + suffix,
  });
  const user = await call("auth/me");
  for (const type of ["requirement", "task", "bug"])
    await call(`projects/${project.id}/work-items`, {
      type,
      title: "图表验收" + type,
      handlers: [user.id],
    });
  await page.goto(`/?view=dictionaries&project=${project.id}`);
  await page.getByRole("button", { name: "新增字典项" }).click();
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await dialog.getByLabel("名称", { exact: true }).fill("启停环境");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await row("启停环境")
    .getByRole("button", { name: "停用", exact: true })
    .click();
  await page
    .locator(".ant-popconfirm")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(
    row("启停环境").getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  await page.goto(`/?view=reports&project=${project.id}`);
  await expect(page.getByRole("img", { name: /完成情况：/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /工作项类型：/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /缺陷严重程度：/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /导出表格/ })).toHaveCount(3);
  await page.getByPlaceholder("搜索编号或标题").fill("图表验收task");
  await page.getByPlaceholder("搜索编号或标题").press("Enter");
  await expect(
    page.locator(".report-summary .ant-statistic-content").first(),
  ).toHaveText("1");
  const href = await page
    .locator('a[href*="table=states"]')
    .getAttribute("href");
  const csv = await page.request.get(href!);
  expect(await csv.text()).toContain("任务");
  expect(await csv.text()).not.toContain("需求");
  await page.screenshot({ path: "../.local/ui57-reports.png", fullPage: true });
  await page.getByRole("menuitem", { name: "回收站", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
});
