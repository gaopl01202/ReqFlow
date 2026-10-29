import { followWorkPage } from "./work-page-navigation";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("编辑与详情：无顶栏、可选描述与默认中、标题图标、独立滚动和底部原子流转", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  const response = await page.request.post("/api/v1/projects", {
    data: { name: "详情布局验收", code: "DTL" + Date.now() },
    headers: { "X-CSRFToken": csrf },
  });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/?view=items&project=${project.id}&type=requirement`);
  await followWorkPage(
    page,
    page.getByRole("link", { name: "新建需求", exact: true }),
  );
  const work = page.locator(".work-page");
  await expect(
    page.getByRole("heading", { name: "新建需求", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "返回列表", exact: true }),
  ).toHaveCount(0);
  await expect(work.locator(".editor-main .ant-form-item-label")).toHaveCount(
    0,
  );
  await expect(
    work.getByPlaceholder("请输入标题", { exact: true }),
  ).toBeVisible();
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(work.getByText("请填写标题", { exact: true })).toBeVisible();
  await work.getByPlaceholder("请输入标题", { exact: true }).fill("仅标题需求");
  await expect(work.getByLabel("优先级", { exact: true })).not.toHaveAttribute(
    "aria-required",
    "true",
  );
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "仅标题需求", exact: true }),
  ).toBeVisible();
  await work.getByRole("button", { name: "编辑标题", exact: true }).click();
  await work.getByLabel("工作项标题", { exact: true }).fill("快速修改标题");
  await work.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    work.getByRole("heading", { name: "快速修改标题", exact: true }),
  ).toBeVisible();
  await expect(
    work.locator(".item-detail-right .ant-tag").filter({ hasText: "中" }),
  ).toBeVisible();
  await work.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(work.getByLabel("描述", { exact: true })).toHaveAttribute(
    "placeholder",
    "请输入描述",
  );
  await work
    .getByLabel("描述", { exact: true })
    .fill(
      Array.from({ length: 60 }, (_, i) => "长描述第" + i + "行").join("\n\n"),
    );
  await expect
    .poll(() =>
      page.locator(".editor-main").evaluate((root) => {
        const panes = [
          root,
          ...Array.from(root.querySelectorAll<HTMLElement>("*")),
        ].filter(
          (node) =>
            /auto|scroll/.test(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight,
        );
        for (const pane of panes) pane.scrollTop = pane.scrollHeight;
        return Math.max(0, ...panes.map((pane) => pane.scrollTop));
      }),
    )
    .toBeGreaterThan(0);
  expect(
    await page.locator(".editor-properties").evaluate((n) => n.scrollTop),
  ).toBe(0);
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "快速修改标题", exact: true }),
  ).toBeVisible();
  await expect(
    work.locator('.item-titlebar button[aria-label="编辑"] .anticon'),
  ).toBeVisible();
  await expect(
    work.locator('.item-titlebar button[aria-label="更多"] .anticon'),
  ).toBeVisible();
  const right = work.locator(".item-detail-right");
  expect(
    await right.evaluate((n) => n.scrollHeight <= n.clientHeight),
  ).toBeTruthy();
  const top = (await right.boundingBox())!.y;
  await work
    .locator(".item-detail-left")
    .evaluate((n) => (n.scrollTop = n.scrollHeight));
  await expect
    .poll(() => work.locator(".item-detail-left").evaluate((n) => n.scrollTop))
    .toBeGreaterThan(0);
  expect(await right.evaluate((n) => n.scrollTop)).toBe(0);
  expect((await right.boundingBox())!.y).toBe(top);
  const row = right.locator(".metadata-row").first();
  const dt = (await row.locator("dt").boundingBox())!,
    dd = (await row.locator("dd").boundingBox())!;
  expect(dd.x).toBeGreaterThan(dt.x);
  expect(Math.abs(dt.y - dd.y)).toBeLessThan(5);
  await expect(
    work.getByRole("button", { name: "确认流转", exact: true }),
  ).toBeInViewport();
  await work
    .locator(".detail-workflow .workflow-stages")
    .getByText("待开始", { exact: true })
    .click();
  await work.getByLabel("流转处理人", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .first()
    .click();
  await work.getByLabel("流转处理人", { exact: true }).press("Escape");
  await work.getByLabel("流转评论", { exact: true }).fill("安排进入开发");
  await work.getByRole("button", { name: "确认流转", exact: true }).click();
  await expect(
    work.locator(
      '.item-detail-right .metadata-row:has(dt:text-is("状态")) .ant-tag',
    ),
  ).toContainText("待开始");
  await expect(work.getByText("安排进入开发", { exact: true })).toBeVisible();
  await expect(
    work
      .locator(".metadata-row")
      .filter({ has: page.getByText("处理人", { exact: true }) }),
  ).toContainText("本地验收");
  await page.reload();
  await expect(
    work.getByRole("button", { name: "编辑", exact: true }),
  ).toBeVisible();
  await expect(work.getByText("安排进入开发", { exact: true })).toBeVisible();
  await work
    .locator(".item-detail-left")
    .evaluate((n) => (n.scrollTop = n.scrollHeight));
  await page.screenshot({ path: "../.local/detail-ui-final.png" });
  expect(errors).toEqual([]);
});
