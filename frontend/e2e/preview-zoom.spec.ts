import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("PDF预览：贯通工具栏、缩放及分页", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1100 });
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
      data: { name: "缩放验收", code: "ZOOM" + Date.now() },
    })
  ).json();
  const imported = await page.request.post(
    `/api/v1/projects/${project.id}/documents/import`,
    {
      headers,
      multipart: {
        file: {
          name: "预览.pdf",
          mimeType: "application/pdf",
          buffer: readFileSync(
            new URL("./fixtures/import-documents/sample.pdf", import.meta.url),
          ),
        },
      },
    },
  );
  expect(imported.ok()).toBeTruthy();
  const record = await imported.json();
  await page.goto(
    `/?view=documents&project=${project.id}&item_type=document&item_mode=detail&item_id=${record.id}`,
  );
  const preview = page.locator(".unified-file-preview");
  await expect(preview).toHaveAttribute("data-preview-ready", "true", {
    timeout: 45000,
  });
  const toolbar = (await page.locator(".pdf-toolbar").boundingBox())!;
  expect(toolbar.x).toBeLessThan(1);
  expect(Math.abs(toolbar.width - 2200)).toBeLessThan(1);
  const titlebar = (await page.locator(".document-titlebar").boundingBox())!;
  expect(titlebar.width).toBe(2200);
  const zoom = page.locator(".pdf-scale-button");
  const canvas = page.locator(".pdfViewer .page canvas").first();
  await expect(canvas).toBeVisible();
  await zoom.click();
  const before = parseInt(await zoom.innerText());
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(async () => parseInt(await zoom.innerText()))
    .toBeGreaterThan(before);
  const enlarged = parseInt(await zoom.innerText());
  await page.getByRole("button", { name: "缩小", exact: true }).click();
  await expect
    .poll(async () => parseInt(await zoom.innerText()))
    .toBeLessThan(enlarged);
  await expect(page.locator(".pdf-page-meter")).toContainText("1");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".pdf-page-meter strong")).toHaveText("2");
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.locator(".pdf-page-meter strong")).toHaveText("1");
});
