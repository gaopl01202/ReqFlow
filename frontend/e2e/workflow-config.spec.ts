import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("工作流表格：自定义状态、任意路径、排序、删除、流转及模板独立", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": token };
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const project = await (
    await page.request.post("/api/v1/projects", {
      headers,
      data: { name: "工作流配置验收", code: "WFUI" + Date.now() },
    })
  ).json();
  await page.goto(`/?view=workflow&project=${project.id}`);
  const manager = page.locator(".workflow-manager");
  await expect(manager.getByRole("tab")).toHaveCount(3);
  await manager.getByRole("tab", { name: "任务", exact: true }).click();
  await manager.getByRole("button", { name: "新建状态", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("状态名称", { exact: true }).fill("临时阶段");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  const row = (name: string) =>
    manager
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
  await row("临时阶段")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(row("临时阶段")).toHaveCount(0);
  await manager.getByRole("button", { name: "新建状态", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("状态名称", { exact: true }).fill("联调阶段");
  await dialog.getByLabel("状态类型", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: /^初始$/ })
    .click();
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  await dialog.getByLabel("下一流转状态", { exact: true }).fill("已完成");
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "已完成" })
    .click();
  await dialog.getByLabel("状态名称", { exact: true }).click();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await row("联调阶段")
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("状态名称", { exact: true })
    .fill("集成联调");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await manager
    .getByRole("button", { name: "拖动状态 集成联调", exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await manager
    .getByRole("button", { name: "拖动状态 集成联调", exact: true })
    .dragTo(row("待开始"));
  // Add a previously unavailable direct edge through the inline next-state selector.
  await manager
    .getByLabel("下一流转状态 待开始", { exact: true })
    .fill("已完成");
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "已完成" })
    .click();
  await manager.getByRole("tab", { name: "需求", exact: true }).click();
  await manager.getByRole("tab", { name: "任务", exact: true }).click();
  await expect(row("集成联调")).toBeVisible();
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("工作流已保存", { exact: true })).toBeVisible();
  await page.reload();
  await manager.getByRole("tab", { name: "任务", exact: true }).click();
  await expect(row("集成联调")).toBeVisible();
  const saved = await (
    await page.request.get(`/api/v1/projects/${project.id}/workflow`)
  ).json();
  const custom = saved.workflow.task.states.find(
    (state: any) => state.name === "集成联调",
  );
  expect(custom.initial).toBeTruthy();
  expect(custom.category).toBe("pending");
  await expect(
    manager.getByRole("columnheader", { name: "状态类型", exact: true }),
  ).toHaveCount(1);
  await expect(
    manager.getByRole("columnheader", { name: "初始状态", exact: true }),
  ).toHaveCount(0);
  await expect(
    manager.getByRole("columnheader", { name: "状态类别", exact: true }),
  ).toHaveCount(0);
  expect(
    saved.workflow.task.transitions.some(
      (edge: any) =>
        edge.from === "ready" && edge.to === "done" && edge.enabled,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "../.local/workflow-config.png" });
  const created = await page.request.post(
    `/api/v1/projects/${project.id}/work-items`,
    {
      headers,
      data: { type: "task", title: "自定义阶段任务", handlers: [me.id] },
    },
  );
  expect(created.ok()).toBeTruthy();
  const item = await created.json();
  expect(item.status).toBe(custom.code);
  await page.goto(
    `/?view=items&project=${project.id}&type=task&item_mode=detail&item_type=task&item_id=${item.id}`,
  );
  await page
    .locator(".detail-workflow .workflow-stages")
    .getByText("已完成", { exact: true })
    .click();
  await page.getByRole("button", { name: "确认流转", exact: true }).click();
  await expect(
    page
      .locator(
        '.item-detail-right .metadata-row:has(dt:text-is("状态")) .ant-tag',
      )
      .getByText("已完成", { exact: true }),
  ).toBeVisible();
  const result = await (
    await page.request.get(`/api/v1/work-items/${item.id}`)
  ).json();
  expect(result.status_category).toBe("completed");
  expect(result.completed_at).toBeTruthy();
  // System default still has its original states after independent project edits.
  await page.goto(`/?view=workflow-template&project=${project.id}`);
  await page
    .locator(".workflow-manager")
    .getByRole("tab", { name: "任务", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "集成联调", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "默认工作流配置", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
