import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { followWorkPage } from "./work-page-navigation";
test("工作项列表分类树：默认分类、三类型筛选、刷新和旧看板兼容", async ({
  page,
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
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": token };
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api/v1/" + path, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const project = await post("projects", {
    name: "分类树验收",
    code: "TREE" + Date.now(),
  });
  const category = await post(`projects/${project.id}/categories`, {
    name: "界面功能",
  });
  for (const type of ["requirement", "task", "bug"]) {
    const extra =
      type === "bug"
        ? { steps_to_reproduce: "点击", actual_result: "异常" }
        : {};
    await post(`projects/${project.id}/work-items`, {
      type,
      title: "默认" + type,
      ...extra,
    });
    await post(`projects/${project.id}/work-items`, {
      type,
      title: "界面" + type,
      category: category.id,
      ...extra,
    });
  }
  await page.evaluate(
    (id) => localStorage.setItem("reqflow:work-view:" + id, "board"),
    me.id,
  );
  await page.goto(`/?view=board&project=${project.id}&type=requirement`);
  await expect(page).toHaveURL(/view=items/);
  await expect(page.getByLabel("工作项视图")).toHaveCount(0);
  await expect(page.locator(".board")).toHaveCount(0);
  await expect(page.getByText("切换项目", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".list-heading")
      .getByRole("tab", { name: "需求", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "工作项", exact: true }),
  ).toHaveCount(0);
  const tree = page.getByLabel("工作项分类", { exact: true });
  const table = page.locator(".ant-table-wrapper").getByRole("table");
  await tree.getByText("界面功能", { exact: true }).click();
  await followWorkPage(
    page,
    page.getByRole("link", { name: "新建需求", exact: true }),
  );
  await expect(page.locator(".editor-properties")).toContainText("界面功能");
  await page.goto(
    `/?view=items&project=${project.id}&type=requirement&category=${category.id}`,
  );
  await expect(table).toContainText("界面requirement");
  await tree.getByRole("button", { name: "新增分类", exact: true }).click();
  await page.getByRole("dialog").getByLabel("名称").fill("临时分类");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(tree.getByText("临时分类", { exact: true })).toBeVisible();
  await tree
    .getByRole("button", { name: "修改分类 临时分类", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("名称").fill("修改后的分类");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(tree.getByText("修改后的分类", { exact: true })).toBeVisible();
  await tree
    .getByRole("button", { name: "删除分类 修改后的分类", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(tree.getByText("修改后的分类", { exact: true })).toHaveCount(0);
  for (const [type, label] of [
    ["requirement", "需求"],
    ["task", "任务"],
    ["bug", "缺陷"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await tree.getByText("全部分类", { exact: true }).click();
    await expect(table).toContainText("默认" + type);
    await expect(table).toContainText("界面" + type);
    await tree.getByText("默认分类", { exact: true }).click();
    await expect(page).toHaveURL(/category=none/);
    await expect(table).toContainText("默认" + type);
    await expect(table).not.toContainText("界面" + type);
    await tree.getByText("界面功能", { exact: true }).click();
    await expect(table).toContainText("界面" + type);
    await expect(table).not.toContainText("默认" + type);
    await page.reload();
    await expect(table).toContainText("界面" + type);
    await expect(table).not.toContainText("默认" + type);
  }
  await expect(tree.locator(".ant-tree-switcher")).toHaveCount(0);
  await expect(tree.getByText("默认分类", { exact: true })).toBeVisible();
  const panel = (await tree.boundingBox())!;
  expect(1000 - panel.y - panel.height).toBeGreaterThanOrEqual(20);
  expect(1000 - panel.y - panel.height).toBeLessThanOrEqual(26);
  const left = (await tree.boundingBox())!,
    right = (await table.boundingBox())!;
  expect(left.x + left.width).toBeLessThan(right.x);
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(table).toContainText("默认bug");
  await expect(table).toContainText("界面bug");
  await expect(tree.getByRole("button", { name: /全部分类/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    table.getByRole("columnheader", { name: "类型", exact: true }),
  ).toHaveCount(0);
  const filters = page.locator(".filter-panel");
  const expand = filters.getByRole("button", { name: "展开", exact: true });
  if (await expand.isVisible()) await expand.click();
  expect(
    await filters
      .locator('.ant-select input[role="combobox"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      ),
  ).toEqual(["状态", "优先级", "负责人", "迭代"]);
  const start = filters.getByPlaceholder("创建开始日期", { exact: true });
  const end = filters.getByPlaceholder("创建结束日期", { exact: true });
  await start.fill("2099-01-01");
  await start.press("Enter");
  await end.fill("2099-12-31");
  await end.press("Enter");
  await expect(page).toHaveURL(/date_from=2099-01-01/);
  await expect(page).toHaveURL(/date_to=2099-12-31/);
  await page.keyboard.press("Escape");
  await expect(table).not.toContainText("默认bug");
  await expect(table).not.toContainText("界面bug");
  await page.reload();
  if (await expand.isVisible()) await expand.click();
  await expect(start).toHaveValue("2099-01-01");
  await expect(end).toHaveValue("2099-12-31");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(start).toHaveValue("");
  await expect(end).toHaveValue("");
  await expect(table).toContainText("默认bug");
  await page.screenshot({
    path: "../.local/category-tree.png",
    animations: "disabled",
  });
  await tree
    .getByRole("button", { name: "删除分类 界面功能", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("删除后都将移动到默认分类");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(tree.getByText("界面功能", { exact: true })).toBeVisible();
  await tree
    .getByRole("button", { name: "删除分类 界面功能", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(tree.getByText("界面功能", { exact: true })).toHaveCount(0);
  for (const kind of ["requirement", "task", "bug"]) {
    const result = await (
      await page.request.get(
        `/api/v1/projects/${project.id}/work-items?type=${kind}&category=none`,
      )
    ).json();
    expect(result.total).toBe(2);
  }
});
