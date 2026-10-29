import { test, expect, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
async function colorText(editor: Locator, name: string, text: string) {
  await editor.fill(text);
  await editor.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const shell = editor.locator(
    "xpath=ancestor::div[contains(@class,'markdown-editor-shell')]",
  );
  await shell.getByRole("button", { name: "文字颜色", exact: true }).click();
  await shell.locator(`[data-type="text-color-${name}"]`).click();
}
test("文字颜色：选中文本、描述保存刷新、评论颜色及HTML安全过滤", async ({
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
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": csrf };
  const project = await (
    await page.request.post("/api/v1/projects", {
      headers,
      data: { name: "颜色验收", code: "COLOR" + Date.now() },
    })
  ).json();
  const item = await (
    await page.request.post(`/api/v1/projects/${project.id}/work-items`, {
      headers,
      data: { type: "requirement", title: "颜色验收" },
    })
  ).json();
  const url = `/?view=items&project=${project.id}&type=requirement&item_mode=detail&item_type=requirement&item_id=${item.id}`;
  await page.goto(url);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await colorText(
    page.getByRole("textbox", { name: "描述", exact: true }),
    "f5222d",
    "红色描述",
  );
  await page
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  const description = page.locator(".detail-description");
  await expect(
    description.locator("span").filter({ hasText: "红色描述" }),
  ).toHaveCSS("color", "rgb(245, 34, 45)");
  await page.reload();
  await expect(
    description.locator("span").filter({ hasText: "红色描述" }),
  ).toHaveCSS("color", "rgb(245, 34, 45)");
  await page.getByRole("button", { name: "添加评论", exact: true }).click();
  await colorText(
    page.getByRole("textbox", { name: "评论内容", exact: true }),
    "1677ff",
    "蓝色评论",
  );
  await page.getByRole("button", { name: "发送评论", exact: true }).click();
  await expect(
    page.locator(".comment-row .markdown span").filter({ hasText: "蓝色评论" }),
  ).toHaveCSS("color", "rgb(22, 119, 255)");
  const record = await (
    await page.request.get(`/api/v1/work-items/${item.id}`)
  ).json();
  expect(record.description).toContain("color: #f5222d");
  await page.request.patch(`/api/v1/work-items/${item.id}`, {
    headers,
    data: {
      version: record.version,
      description:
        '<span style="color: #389e0d">合法颜色</span><span style="position:fixed;color:red" onclick="alert(1)">非法样式</span><script>window.unsafeColor=true</script><img src="https://example.com/x.png" onerror="alert(1)">',
    },
  });
  await page.goto(url);
  await expect(description.getByText("合法颜色", { exact: true })).toHaveCSS(
    "color",
    "rgb(56, 158, 13)",
  );
  await expect(
    description.getByText("非法样式", { exact: true }),
  ).not.toHaveAttribute("style");
  await expect(
    description.locator("script, [onclick], [onerror], img"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).unsafeColor),
  ).toBeUndefined();
});
