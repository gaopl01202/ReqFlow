import { followWorkPage } from "./work-page-navigation";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const password = readFileSync(
  new URL("../../.local/e2e-password", import.meta.url),
  "utf8",
);
test("新团队：项目 → 需求 → 任务 → 列表流转完成 → 报表 → 文档", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: true }).fill("e2e-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("最近访问项目", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "项目管理" }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const dialog = page.locator(".ant-modal:visible");
  await dialog.getByLabel("项目名称", { exact: true }).fill("浏览器验收项目");
  const projectCode = "E2E" + Date.now();
  await dialog.getByLabel("项目编码", { exact: true }).fill(projectCode);
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: projectCode, exact: true }) })
    .getByRole("button", { name: "进入项目" })
    .click();
  await expect(page.getByLabel("工作项分类", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "需求", exact: true }).click();
  await followWorkPage(page, page.getByRole("link", { name: "新建需求" }));
  const work = page.locator(".work-page");
  await expect(dialog).toHaveCount(0);
  await work.getByLabel("标题", { exact: true }).fill("交付需求");
  await work
    .getByLabel("描述", { exact: true })
    .fill("需求的验收标准与实现说明");
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "交付需求", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "交付需求", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "任务", exact: true }).click();
  await followWorkPage(page, page.getByRole("link", { name: "新建任务" }));
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(work.getByText("请填写标题")).toBeVisible();
  await work.getByLabel("标题", { exact: true }).fill("端到端执行任务");
  await work.getByLabel("关联需求", { exact: true }).click();
  await page.getByTitle("交付需求", { exact: true }).click();
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "端到端执行任务", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "端到端执行任务", exact: true }),
  ).toBeVisible();
  await followWorkPage(
    page,
    page
      .getByRole("row")
      .filter({ hasText: "端到端执行任务" })
      .getByRole("link")
      .first(),
  );
  const drawer = work;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    drawer.getByRole("heading", { name: "端到端执行任务" }),
  ).toBeVisible();
  await drawer.getByLabel("流转处理人", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .first()
    .click();
  await drawer.getByLabel("流转处理人", { exact: true }).press("Escape");
  for (const state of ["进行中", "待确认", "已完成"]) {
    await drawer
      .locator(".detail-workflow .workflow-stages")
      .getByText(state, { exact: true })
      .click();
    await drawer.getByRole("button", { name: "确认流转", exact: true }).click();
    await expect(
      drawer
        .locator(
          '.item-detail-right .metadata-row:has(dt:text-is("状态")) .ant-tag',
        )
        .getByText(state, { exact: true }),
    ).toBeVisible();
  }
  await drawer.getByRole("button", { name: "添加评论", exact: true }).click();
  await drawer.getByLabel("评论内容").fill("验收通过");
  await drawer.getByRole("button", { name: "发送评论" }).click();
  await expect(drawer.getByText("验收通过", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await page.getByRole("menuitem", { name: "统计报表" }).click();
  await expect(page.getByText("成员工作量", { exact: true })).toBeVisible();
  await expect(page.getByText("成员工作量", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "项目文档" }).click();
  await page.locator('.list-heading input[type="file"]').setInputFiles({
    name: "验收记录.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("完整工作流已验证。"),
  });
  await expect(
    page.getByRole("link", { name: "验收记录.txt", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../.local/e2e-delivery.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("用户与协作：一次性密码 → 成员 → 迭代 → 未完成项保留", async ({
  page,
}) => {
  const suffix = String(Date.now());
  await page.goto("/");
  await page.getByLabel("登录账号", { exact: true }).fill("e2e-local");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("最近访问项目", { exact: true })).toBeVisible();
  const dialog = page.locator(".ant-modal:visible");
  await page.getByRole("menuitem", { name: "用户管理" }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await dialog.getByLabel("登录账号", { exact: true }).fill("member-" + suffix);
  await dialog
    .getByLabel("姓名", { exact: true })
    .fill("成员" + suffix.slice(-6));
  await dialog.getByLabel("职务", { exact: true }).click();
  await page.getByTitle("团队成员", { exact: true }).click();
  await dialog.getByLabel("用户组", { exact: true }).fill("普通用户");
  await page.getByTitle("普通用户", { exact: true }).click();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByText("一次性临时密码", { exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "一次性临时密码", exact: true })
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("menuitem", { name: "项目管理" }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await dialog
    .getByLabel("项目名称", { exact: true })
    .fill("协作项目" + suffix);
  await dialog.getByLabel("项目编码", { exact: true }).fill("COL" + suffix);
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "COL" + suffix, exact: true }),
    })
    .getByRole("button", { name: "进入项目" })
    .click();
  await page.getByRole("menuitem", { name: "项目成员" }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await dialog
    .getByLabel("用户", { exact: true })
    .fill("成员" + suffix.slice(-6));
  await page.getByTitle("成员" + suffix.slice(-6), { exact: true }).click();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "成员" + suffix.slice(-6), exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "迭代规划" }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill("验收迭代");
  await dialog.getByLabel("负责人", { exact: true }).click();
  await page.getByTitle("本地验收", { exact: true }).click();
  await dialog.getByLabel("开始日期", { exact: true }).fill("2026-10-19");
  await dialog.getByLabel("开始日期", { exact: true }).press("Enter");
  await dialog.getByLabel("结束日期", { exact: true }).fill("2026-10-26");
  await dialog.getByLabel("结束日期", { exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "开始", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "结束", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "工作项", exact: true }).click();
  await followWorkPage(page, page.getByRole("link", { name: "新建任务" }));
  const work = page.locator(".work-page");
  await work.getByLabel("标题", { exact: true }).fill("保留未完成事项");
  await work.getByLabel("负责人", { exact: true }).click();
  await page.getByTitle("成员" + suffix.slice(-6), { exact: true }).click();
  await work.getByLabel("迭代", { exact: true }).click();
  await page.getByTitle("验收迭代", { exact: true }).click();
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "保留未完成事项", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await page.getByRole("menuitem", { name: "迭代规划" }).click();
  await page.getByRole("button", { name: "结束", exact: true }).click();
  await dialog.getByLabel("未完成项处置", { exact: true }).click();
  await page.getByTitle("保留在本迭代", { exact: true }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "已结束", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "工作项", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "保留未完成事项", exact: true }),
  ).toBeVisible();
});
