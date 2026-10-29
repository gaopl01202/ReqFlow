import { followWorkPage } from "./work-page-navigation";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("新建布局：标题仅底线、Markdown即时渲染与粘贴图片、横排属性、附件位置、固定底栏", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const remote: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5174") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      remote.push(r.url());
  });
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
  const response = await page.request.post("/api/v1/projects", {
    data: { name: "新建布局验收", code: "IR" + Date.now() },
    headers: { "X-CSRFToken": token },
  });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/?view=items&project=${project.id}&type=requirement`);
  await followWorkPage(page, page.getByRole("link", { name: "新建需求" }));
  const work = page.locator(".work-page");
  const title = work.getByLabel("标题", { exact: true });
  await title.fill("即时 Markdown 需求");
  await title.focus();
  expect(
    await title.evaluate((node) => {
      const s = getComputedStyle(node);
      return [
        s.borderTopWidth,
        s.borderRightWidth,
        s.borderLeftWidth,
        s.borderBottomWidth,
        s.boxShadow,
      ];
    }),
  ).toEqual(["0px", "0px", "0px", "1px", "none"]);
  const description = work.getByRole("textbox", { name: "描述", exact: true });
  await description.fill("# 即时标题");
  await description.press("Enter");
  await description.pressSequentially("**重点内容**");
  await description.press("Enter");
  await expect(work.locator(".vditor-ir h1")).toContainText("即时标题");
  await expect(work.locator(".vditor-ir strong")).toContainText("重点内容");
  await description.focus();
  await page.evaluate(() => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const files = new DataTransfer();
    files.items.add(new File([bytes], "粘贴图片.png", { type: "image/png" }));
    document.querySelector(".vditor-ir [contenteditable]")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: files,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(work.locator(".vditor-ir img")).toBeVisible();
  await expect(work.locator(".pending-attachments")).toContainText(
    "粘贴图片.png",
  );
  const label = work
    .locator(".editor-properties .field-property")
    .first()
    .locator(".ant-form-item-label");
  const control = work
    .locator(".editor-properties .field-property")
    .first()
    .locator(".ant-form-item-control");
  const a = (await label.boundingBox())!,
    b = (await control.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(10);
  const rects = await work.evaluate((node) => {
    const content = node
        .querySelector(".field-content")!
        .getBoundingClientRect(),
      files = node
        .querySelector(".pending-attachments")!
        .getBoundingClientRect();
    return {
      content: {
        left: content.left,
        right: content.right,
        bottom: content.bottom,
      },
      files: { left: files.left, right: files.right, top: files.top },
    };
  });
  expect(rects.files.left).toBeGreaterThan(rects.content.right);
  expect(rects.files.right).toBeGreaterThan(rects.content.right);
  expect(rects.files.top).toBeGreaterThan(0);
  for (const height of [900, 560]) {
    await page.setViewportSize({ width: 1440, height });
    await page.locator(".content").evaluate((node) => (node.scrollTop = 0));
    const footer = work.locator(".form-footer");
    expect(
      await footer.evaluate((node) => getComputedStyle(node).position),
    ).toBe("fixed");
    const before = (await footer.boundingBox())!;
    expect(Math.round(before.y + before.height)).toBe(height);
    await page
      .locator(".content")
      .evaluate((node) => (node.scrollTop = node.scrollHeight));
    const after = (await footer.boundingBox())!;
    expect(after.y).toBe(before.y);
    await expect(
      footer.getByRole("button", { name: /^(创建|保存)$/, exact: true }),
    ).toBeInViewport();
    await expect(
      footer.getByRole("button", { name: "取消", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: /^(创建|保存)$/, exact: true }),
    ).toHaveCount(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".content").evaluate((node) => (node.scrollTop = 0));
  await page.screenshot({ path: "../.local/editor-layout-final.png" });
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "即时 Markdown 需求", exact: true }),
  ).toBeVisible();
  await expect(work.locator(".markdown h1")).toContainText("即时标题");
  await expect(work.locator(".markdown strong")).toContainText("重点内容");
  await expect(work.locator(".markdown img")).toBeVisible();
  await page.reload();
  await expect(work.locator(".markdown img")).toBeVisible();
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
