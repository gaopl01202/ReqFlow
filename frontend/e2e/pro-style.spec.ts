import { followWorkPage } from "./work-page-navigation";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function login(page: Page) {
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
}
async function command(
  page: Page,
  path: string,
  method = "GET",
  data?: unknown,
) {
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const response = await page.request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { "X-CSRFToken": token },
  });
  expect(response.ok(), path).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

test("Pro 样式：人员菜单、中文日历、固定操作列、分类与工作流拖动、优先级配色", async ({
  page,
}) => {
  await login(page);
  const suffix = String(Date.now());
  const project = await command(page, "projects", "POST", {
    name: "团队协作平台 · 界面验收",
    code: "STYLE" + suffix,
  });
  const pid = project.id;
  const priority = await command(page, `projects/${pid}/dictionaries`, "POST", {
    kind: "priority",
    name: "紧急 · " + suffix.slice(-4),
    color: "purple",
  });
  const a = await command(page, `projects/${pid}/categories`, "POST", {
    name: "产品体验",
  });
  const b = await command(page, `projects/${pid}/categories`, "POST", {
    name: "基础功能",
  });
  await command(page, `projects/${pid}/work-items`, "POST", {
    type: "task",
    title: "完善项目首页与工作台交互",
    priority: priority.id,
  });
  await page.goto(`/?view=items&project=${pid}&type=task`);
  await expect(
    page.getByRole("cell", { name: "完善项目首页与工作台交互", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: "完善项目首页与工作台交互",
          exact: true,
        }),
      })
      .evaluate((row) => row.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(50);
  await expect(page.locator(".page-heading h2")).toHaveCount(0);
  await expect(page.locator(".work-type-tabs")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "修改密码", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "用户菜单" }).click();
  await expect(
    page.getByRole("menuitem", { name: "修改密码", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "退出登录", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("个人资料", { exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "修改密码", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "修改密码" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "修改密码" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "展开" }).click();
  await page.getByPlaceholder("创建开始日期", { exact: true }).click();
  const calendar = page.locator(".ant-picker-dropdown:visible");
  await expect(calendar.getByRole("columnheader")).toHaveText([
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "日",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "日",
  ]);
  await page.screenshot({ path: "../.local/pro-calendar.png" });
  await page.keyboard.press("Escape");
  await page.getByLabel("工作项分类", { exact: true }).click();
  await expect(page.locator(".ant-picker-dropdown:visible")).toHaveCount(0);
  await expect(page.locator("input[type=date]")).toHaveCount(0);
  const operation = page.getByRole("columnheader", {
    name: "操作",
    exact: true,
  });
  await expect(operation).toHaveCSS("position", "sticky");
  await expect(operation).toHaveCSS("right", "0px");
  await page
    .locator(".ant-table-content")
    .evaluate((node) => (node.scrollLeft = node.scrollWidth));
  const rect = await operation.boundingBox();
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(1440);
  await page
    .locator(".ant-table-content")
    .evaluate((node) => (node.scrollLeft = 0));
  await page.screenshot({ path: "../.local/pro-list.png" });
  await page.goto(`/?view=categories&project=${pid}`);
  const row = (name: string) =>
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
  await expect(row(b.name)).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "排序", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("排序", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  const sorted = page.waitForResponse((r) =>
    r.url().includes("/categories/reorder"),
  );
  await page
    .getByRole("button", { name: "拖动排序 " + b.name, exact: true })
    .dragTo(row(a.name), { targetPosition: { x: 100, y: 5 } });
  expect((await sorted).status()).toBe(200);
  await page.reload();
  await expect(row(b.name)).toBeVisible();
  expect(
    (await command(page, `projects/${pid}/categories`)).items.map(
      (r: any) => r.id,
    ),
  ).toEqual([b.id, a.id]);
  await page.goto(`/?view=workflow&project=${pid}`);
  await expect(page.getByText("planned", { exact: true })).toHaveCount(0);
  await expect(page.getByText("blue", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/列顺序/)).toHaveCount(0);
  const taskCard = page.locator(".workflow-manager");
  await taskCard.getByRole("tab", { name: "任务", exact: true }).click();
  const active = taskCard.getByRole("button", {
    name: "拖动状态 进行中",
    exact: true,
  });
  const ready = taskCard
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "待开始", exact: true }) });
  await active.dragTo(ready, { targetPosition: { x: 10, y: 10 } });
  await taskCard.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("工作流已保存", { exact: true })).toBeVisible();
  const states = (await command(page, `projects/${pid}/workflow`)).workflow.task
    .states;
  expect([...states].sort((x, y) => x.order - y.order)[0].code).toBe("active");
  await page.goto(`/?view=dictionaries&project=${pid}`);
  await page.getByRole("tab", { name: "优先级", exact: true }).click();
  await expect(row(priority.name)).toBeVisible();
  await expect(
    row(priority.name).getByRole("cell", { name: "紫色", exact: true }),
  ).toBeVisible();
  await row(priority.name)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("颜色", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "红色" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(
    row(priority.name).getByRole("cell", { name: "红色", exact: true }),
  ).toBeVisible();
  expect(
    (await command(page, `projects/${pid}/dictionaries/` + priority.id)).color,
  ).toBe("red");
  await page.goto(`/?view=items&project=${pid}&type=task`);
  await expect(
    page
      .getByRole("cell", { name: priority.name, exact: true })
      .locator(".ant-tag"),
  ).toHaveClass(/ant-tag-red/);
});

test("需求、任务、缺陷独立表单与详情：保存、编辑、刷新、返回和中文日期", async ({
  page,
}) => {
  await login(page);
  const suffix = String(Date.now());
  const project = await command(page, "projects", "POST", {
    name: "工作项独立页面验收",
    code: "PAGE" + suffix,
  });
  for (const [kind, name] of [
    ["requirement", "需求"],
    ["task", "任务"],
    ["bug", "缺陷"],
  ]) {
    await page.goto(`/?view=items&project=${project.id}&type=${kind}`);
    await followWorkPage(
      page,
      page.getByRole("link", { name: "新建" + name, exact: true }),
    );
    const work = page.locator(".work-page");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/item_mode=create/);
    await work.getByLabel("标题", { exact: true }).fill(name + "独立页面验收");
    if (kind === "requirement")
      await work
        .getByLabel("描述", { exact: true })
        .fill("支持独立页面、刷新恢复和列表返回。");
    if (kind === "task") {
      await work.getByLabel("计划开始日期", { exact: true }).fill("2026-10-19");
      await work.getByLabel("计划开始日期", { exact: true }).press("Enter");
      await work.getByLabel("截止日期", { exact: true }).fill("2026-10-26");
      await work.getByLabel("截止日期", { exact: true }).press("Enter");
    }
    await work
      .getByRole("button", { name: /^(创建|保存)$/, exact: true })
      .click();
    await expect(
      work.getByRole("heading", { name: name + "独立页面验收", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/p\//);
    const id = (
      await (
        await page.request.get(
          `/api/v1/links/${project.code}/${kind}/${new URL(page.url()).pathname.split("/").pop()}`,
        )
      ).json()
    ).id;
    if (kind === "task") {
      const task = await command(page, "work-items/" + id);
      expect(task.planned_start_date).toBe("2026-10-19");
      expect(task.due_date).toBe("2026-10-26");
    }
    await page.reload();
    await expect(
      work.getByRole("heading", { name: name + "独立页面验收", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await work.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await page.reload();
    await expect(work.getByLabel("标题", { exact: true })).toHaveValue(
      name + "独立页面验收",
    );
    await work.getByLabel("标题", { exact: true }).fill(name + "编辑后保留");
    await work
      .getByRole("button", { name: /^(创建|保存)$/, exact: true })
      .click();
    await expect(
      work.getByRole("heading", { name: name + "编辑后保留", exact: true }),
    ).toBeVisible();
    if (kind === "task")
      await page.screenshot({ path: "../.local/pro-detail.png" });
    await page.getByRole("button", { name: "返回列表", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: name + "编辑后保留", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      work.getByRole("heading", { name: name + "编辑后保留", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "用户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
});
