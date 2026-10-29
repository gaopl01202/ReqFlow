import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("项目字典管理、独立模板、精简工作项表单", async ({ page }) => {
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
  const result = await page.request.post("/api/v1/projects", {
    headers: { "X-CSRFToken": token },
    data: { name: "字典维护验收", code: "DICTUI" + Date.now() },
  });
  expect(result.ok()).toBeTruthy();
  const project = await result.json();
  await page.goto(`/?view=dictionaries&project=${project.id}`);
  await expect(
    page.getByRole("menuitem", { name: "分类设置", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "默认字典管理", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "测试环境", exact: true }),
  ).toBeVisible();
  for (const name of ["严重程度", "优先级", "来源", "环境"])
    await page.getByRole("tab", { name, exact: true }).click();
  await page.getByRole("button", { name: "新增字典项" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("名称", { exact: true })
    .fill("集成环境");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "集成环境", exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("名称", { exact: true })
    .fill("自定义环境");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "自定义环境", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "拖动 自定义环境", exact: true })
    .focus();
  const ordered = page.waitForResponse((response) =>
    response.url().includes("/dictionaries/reorder"),
  );
  await page.keyboard.press("ArrowUp");
  expect((await ordered).ok()).toBeTruthy();
  await page.goto(`/?view=priorities&project=${project.id}`);
  await expect(
    page.getByRole("tab", { name: "环境", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "自定义环境", exact: true }),
  ).toHaveCount(0);
  await page.goto(
    `/?view=items&project=${project.id}&type=bug&item_mode=create&item_type=bug`,
  );
  await expect(page.getByLabel("标题", { exact: true })).toBeVisible();
  for (const label of ["复现步骤", "实际结果", "预期结果"])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await page.getByLabel("标题", { exact: true }).fill("精简缺陷表单");
  await page.getByLabel("环境", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "自定义环境" })
    .click();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "精简缺陷表单", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("自定义环境", { exact: true })).toBeVisible();
  await page.goto(
    `/?view=items&project=${project.id}&type=requirement&item_mode=create&item_type=requirement`,
  );
  await expect(page.getByLabel("标题", { exact: true })).toBeVisible();
  await expect(page.getByLabel("验收标准", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("预计完成日期", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../.local/dictionaries-form.png" });
});
