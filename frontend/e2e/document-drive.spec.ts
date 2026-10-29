import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("项目网盘：文件夹层级、上传归属、图标、刷新与关闭预览", async ({
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
      data: { name: "项目文件验收", code: "DRIVE" + Date.now() },
    })
  ).json();
  await page.goto(`/?view=documents&project=${project.id}`);
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /上传文档$/ })).toBeVisible();
  for (const title of ["产品资料", "设计方案"]) {
    await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
    await page.getByRole("textbox", { name: "文件夹名称" }).fill(title);
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("table")
      .getByRole("link", { name: title, exact: true })
      .click();
    await expect(page.locator(".drive-breadcrumb")).toContainText(title);
  }
  const folder = new URL(page.url()).searchParams.get("parent");
  expect(folder).toBeTruthy();
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith("/documents/import") && r.request().method() === "POST",
  );
  await page
    .locator(".list-heading input[type=file]")
    .setInputFiles(
      new URL("./fixtures/import-documents/sample.pdf", import.meta.url)
        .pathname,
    );
  const response = await imported;
  expect(response.status()).toBe(201);
  const record = await response.json();
  expect(record.parent).toBe(folder);
  await expect(page.getByText("上传成功", { exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "sample.pdf" });
  await expect(row.locator(".drive-file-icon")).toBeVisible();
  await expect(row).toContainText("KB");
  await page.reload();
  await expect(row).toBeVisible();
  await expect(page.locator(".drive-breadcrumb")).toContainText("产品资料");
  const [preview] = await Promise.all([
    page.waitForEvent("popup"),
    row.getByRole("link", { name: "sample.pdf", exact: true }).click(),
  ]);
  await expect(preview.locator(".pdfViewer .page canvas").first()).toBeVisible({
    timeout: 45000,
  });
  const closed = preview.waitForEvent("close");
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await closed;
  await page
    .locator(".drive-breadcrumb")
    .getByText("全部文件", { exact: true })
    .click();
  await expect(
    page
      .getByRole("table")
      .getByRole("link", { name: "产品资料", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table")
      .getByRole("link", { name: "sample.pdf", exact: true }),
  ).toHaveCount(0);
  const root = (
    await (
      await page.request.get(`/api/v1/projects/${project.id}/documents`)
    ).json()
  ).items[0];
  const denied = await page.request.delete(`/api/v1/documents/${root.id}`, {
    headers,
    data: { version: root.version },
  });
  expect(denied.status()).toBe(422);
  await page.screenshot({ path: "../.local/document-drive.png" });
});
