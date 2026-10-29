import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("语义配色：菜单、字典自定义颜色及工作项新建/详情/列表一致", async ({
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
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": token };
  const post = async (path: string, data: unknown) => {
    const result = await page.request.post("/api/v1/" + path, {
      headers,
      data,
    });
    expect(result.ok(), await result.text()).toBeTruthy();
    return result.json();
  };
  const project = await post("projects", {
    code: "COLOR" + Date.now(),
    name: "语义配色验收",
  });
  await post(`projects/${project.id}/dictionaries`, {
    kind: "environment",
    name: "验收彩色环境",
    color: "purple",
  });
  await page.goto(
    `/?view=items&project=${project.id}&type=bug&item_mode=create&item_type=bug`,
  );
  await expect(
    page.getByRole("menuitem", { name: "工作流配置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "默认工作流配置", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".work-type-badge.ant-tag-red")).toHaveText("缺陷");
  await expect(page.locator(".editor-status-tag")).toHaveCount(0);
  const choose = async (label: string, name: string, color: string) => {
    await page.getByLabel(label, { exact: true }).fill(name);
    const option = page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: name });
    await expect(option.locator(".ant-tag-" + color)).toHaveText(name);
    await option.click();
    await page.getByLabel(label, { exact: true }).press("Escape");
  };
  await page.getByLabel("标题", { exact: true }).fill("彩色缺陷");
  await choose("优先级", "高", "red");
  await choose("环境", "验收彩色环境", "purple");
  await choose("严重程度", "严重", "orange");
  await expect(page.locator(".editor-properties .ant-tag-orange")).toHaveText(
    "严重",
  );
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "彩色缺陷", exact: true }),
  ).toBeVisible();
  const right = page.locator(".item-detail-right");
  await expect(right.locator(".ant-tag-orange")).toHaveText("严重");
  await expect(right.locator(".ant-tag-purple")).toHaveText("验收彩色环境");
  await expect(page.locator(".item-detail-right .ant-tag-gold")).toHaveText(
    "待确认",
  );
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "彩色缺陷", exact: true }) });
  await expect(row.locator(".ant-tag-orange")).toHaveText("严重");
  await expect(row.locator(".ant-tag-purple")).toHaveText("验收彩色环境");
  await expect(row.locator(".ant-tag-red")).toHaveText("高");
  await expect(row.locator(".ant-tag-gold")).toHaveText("待确认");
  await page.screenshot({ path: "../.local/semantic-colors-list.png" });
  await page.goto(
    `/?view=items&project=${project.id}&type=requirement&item_mode=create&item_type=requirement`,
  );
  await expect(page.locator(".work-type-badge.ant-tag-blue")).toHaveText(
    "需求",
  );
  await expect(page.locator(".editor-status-tag")).toHaveCount(0);
  await page.getByLabel("标题", { exact: true }).fill("彩色来源需求");
  await choose("来源", "用户反馈", "purple");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "彩色来源需求", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".item-detail-right .ant-tag-purple")).toHaveText(
    "用户反馈",
  );
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", { name: "彩色来源需求", exact: true }),
      })
      .locator(".ant-tag-purple"),
  ).toHaveText("用户反馈");
});
