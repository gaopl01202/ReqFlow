import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("统一预览：Office六格式、XMind及保留格式，本地资源与原件下载", async ({
  page,
}) => {
  test.setTimeout(240000);
  const missingAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/file-viewer/") && !response.ok())
      missingAssets.push(response.url());
  });
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:5174/")
    )
      external.push(r.url());
  });
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
  const headers = { "X-CSRFToken": csrf };
  const project = await (
    await page.request.post("/api/v1/projects", {
      headers,
      data: { name: "统一预览验收", code: "FV" + Date.now() },
    })
  ).json();
  for (const kind of [
    "docx",
    "doc",
    "xlsx",
    "xls",
    "pptx",
    "ppt",
    "pdf",
    "xmind",
    "json",
    "md",
    "png",
    "txt",
    "csv",
  ]) {
    const filename = `01027DG02-GI001-A01#EPL-RP-0201-0 说明书?版本%20.${kind}`;
    const bytes = readFileSync(
      new URL(`./fixtures/import-documents/sample.${kind}`, import.meta.url),
    );
    const response = await page.request.post(
      `/api/v1/projects/${project.id}/documents/import`,
      {
        headers,
        multipart: {
          file: {
            name: filename,
            mimeType: "application/octet-stream",
            buffer: bytes,
          },
        },
      },
    );
    expect(response.status(), `${kind}: ${await response.text()}`).toBe(201);
    const record = await response.json();
    await page.goto(
      `/?view=documents&project=${project.id}&item_type=document&item_mode=detail&item_id=${record.id}`,
    );
    await expect(page.locator(".unified-file-preview"), kind).toHaveAttribute(
      "data-preview-ready",
      "true",
      { timeout: 45000 },
    );
    if (kind === "pdf")
      await expect(
        page.locator(".pdfViewer .page canvas").first(),
      ).toBeVisible();
    if (kind === "doc" || kind === "docx") {
      const stage = page.locator(
        kind === "doc" ? ".msdoc-stage" : ".docx-wrapper",
      );
      await expect(stage).toHaveCSS("background-color", "rgb(231, 233, 236)");
      await expect(stage).toHaveCSS("padding-top", "24px");
    }
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page
        .locator(".preview-side-tools")
        .getByRole("button", { name: "下载", exact: true })
        .click(),
    ]);
    expect(download.suggestedFilename()).toBe(filename.replaceAll("?", "_"));
    await page.screenshot({ path: `../.local/file-viewer-${kind}.png` });
    const original = await page.request.get(record.download_url);
    expect(await original.body(), kind).toEqual(bytes);
  }
  await page.route("**/api/v1/documents/*", async (route) => {
    const response = await route.fetch();
    const record = await response.json();
    await route.fulfill({
      response,
      json: {
        ...record,
        document_type: "unknown",
        original_name: "unsupported.unknown",
      },
    });
  });
  await page.reload();
  await expect(page.getByText(/^当前支持：/)).toContainText("docx");
  await expect(page.getByText(/^当前支持：/)).toContainText("xmind");
  await expect(page.getByText(/^当前支持：/)).not.toContainText("CAD");
  expect(missingAssets).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
