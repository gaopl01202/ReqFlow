import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("项目文档：网盘列表、Office/TXT上传预览下载及只读", async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    (window as any).__paintedText = [];
    const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      ...args: Parameters<typeof paint>
    ) {
      (window as any).__paintedText.push(String(args[0]));
      return paint.apply(this, args);
    };
  });

  const remote: string[] = [];
  page.on("request", (request) => {
    if (!/^(?:http:\/\/127\.0\.0\.1:5174|data:|blob:)/.test(request.url()))
      remote.push(request.url());
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
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": csrf };
  const project = await (
    await page.request.post("/api/v1/projects", {
      headers,
      data: { name: "文档导入验收", code: "DOC" + Date.now() },
    })
  ).json();
  const listUrl = `/?view=documents&project=${project.id}`;
  await page.goto(listUrl);
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toHaveCount(0);
  for (const kind of [
    "txt",
    "docx",
    "xlsx",
    "pptx",
    "csv",
    "doc",
    "xls",
    "ppt",
    "pdf",
  ]) {
    await page.goto(listUrl);
    const file = new URL(
      `./fixtures/import-documents/sample.${kind}`,
      import.meta.url,
    );
    const result = page.waitForResponse(
      (response) =>
        response.url().endsWith("/documents/import") &&
        response.request().method() === "POST",
    );
    await page
      .locator('.list-heading input[type="file"]')
      .setInputFiles(file.pathname);
    const response = await result;
    expect(response.ok(), await response.text()).toBeTruthy();
    const record = await response.json();
    await expect(page.getByText("上传成功", { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/item_mode=detail/);
    await expect(page.getByRole("table")).toBeVisible();
    const title = page.locator(`a[href*="item_id=${record.id}"]`);
    const [previewWindow] = await Promise.all([
      page.waitForEvent("popup"),
      title.click(),
    ]);
    await previewWindow.waitForLoadState("domcontentloaded");
    const previewUrl = previewWindow.url();
    const closed = previewWindow.waitForEvent("close");
    await previewWindow
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await closed;
    await page.bringToFront();
    await page.goto(previewUrl);

    await expect(
      page.getByLabel("文档在线预览", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "编辑文档", exact: true }),
    ).toHaveCount(0);
    expect(
      (await page.getByLabel("文档在线预览", { exact: true }).boundingBox())!
        .width,
    ).toBeGreaterThan(950);
    const preview = await page.request.get(record.preview_url);
    expect(preview.ok()).toBeTruthy();
    expect(await preview.body()).toEqual(readFileSync(file));
    await expect(page.locator(".unified-file-preview")).toHaveAttribute(
      "data-preview-ready",
      "true",
      { timeout: 45000 },
    );
    if (["xls", "xlsx", "csv"].includes(kind)) {
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__paintedText.join(" ")),
        )
        .toContain("Preview");
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__paintedText.join(" ")),
        )
        .toContain("42");
    }
    const download = await page.request.get(record.download_url);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    expect(await download.body()).toEqual(readFileSync(file));
    await page.reload();
    await expect(
      page.getByLabel("文档在线预览", { exact: true }),
    ).toBeVisible();
    await page.goto(
      `/?view=documents&project=${project.id}&item_mode=edit&item_type=document&item_id=${record.id}`,
    );
    await expect(
      page.getByLabel("文档在线预览", { exact: true }),
    ).toBeVisible();
    const patch = await page.request.patch(`/api/v1/documents/${record.id}`, {
      headers,
      data: { version: record.version, body: "不能编辑" },
    });
    expect(patch.status()).toBe(422);
    await page.goto(listUrl);
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "sample" })
        .filter({ hasText: kind })
        .first(),
    ).toBeVisible();
  }
  expect(remote).toEqual([]);
  await page.goto(listUrl);
  await page.locator('.list-heading input[type="file"]').setInputFiles({
    name: "too-large.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(10485761, "a"),
  });
  await expect(
    page.getByText("文档不能为空且不能超过 10 MB", { exact: true }),
  ).toBeVisible();
});
