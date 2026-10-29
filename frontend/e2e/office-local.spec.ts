import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("统一Office：复杂图文、图表、多工作表与外部链接隔离", async ({ page }) => {
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
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": token };
  const project = await (
    await page.request.post("/api/v1/projects", {
      headers,
      data: { name: "本地Office预览", code: "OFF" + Date.now() },
    })
  ).json();
  for (const name of ["rich.docx", "rich.pptx", "multiple.xlsx"]) {
    const response = await page.request.post(
      `/api/v1/projects/${project.id}/documents/import`,
      {
        headers,
        multipart: {
          file: {
            name,
            mimeType: "application/octet-stream",
            buffer: readFileSync(
              new URL(`./fixtures/import-documents/${name}`, import.meta.url),
            ),
          },
        },
      },
    );
    expect(response.status()).toBe(201);
    const record = await response.json();
    await page.goto(
      `/?view=documents&project=${project.id}&item_mode=detail&item_type=document&item_id=${record.id}`,
    );
    const preview = page.locator(".unified-file-preview");
    await expect(preview).toHaveAttribute("data-preview-ready", "true", {
      timeout: 45000,
    });
    if (name === "rich.docx") {
      await expect(preview).toContainText("本地原件预览");
      const floating = preview.locator(".preview-side-tools");
      await expect(preview.locator(".file-viewer-web-shell")).toHaveAttribute(
        "data-viewer-theme",
        "light",
      );
      const bounds = (await preview.boundingBox())!;
      const controls = (await floating.boundingBox())!;
      expect(
        Math.abs(bounds.x + bounds.width - controls.x - controls.width - 24),
      ).toBeLessThan(2);
      expect(
        await floating
          .getByRole("button")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-label")),
          ),
      ).toEqual([
        "搜索文档",
        "下载",
        "放大预览",
        "恢复到 100%",
        "缩小预览",
        "全屏",
      ]);
      await expect(floating.getByRole("separator")).toHaveCount(2);
      const side = preview.locator(".preview-side-tools");
      const sideBounds = (await side.boundingBox())!;
      expect(
        Math.abs(
          sideBounds.y + sideBounds.height / 2 - bounds.y - bounds.height / 2,
        ),
      ).toBeLessThan(2);
      await side.getByRole("button", { name: "搜索文档", exact: true }).click();
      await expect(
        page
          .locator(".document-title-actions")
          .getByRole("button", { name: "下载原文件" }),
      ).toHaveCount(0);
      await expect(floating.locator(".preview-zoom-value")).toContainText("%");
      await expect(preview.locator("section.docx").first()).toHaveCSS(
        "background-color",
        "rgb(255, 255, 255)",
      );
      const ratioBefore = parseInt(
        await floating.locator(".preview-zoom-value").innerText(),
      );
      await floating.getByRole("button", { name: "放大预览" }).click();
      await expect
        .poll(async () =>
          parseInt(await floating.locator(".preview-zoom-value").innerText()),
        )
        .toBeGreaterThan(ratioBefore);
      await floating.getByRole("button", { name: "恢复到 100%" }).click();
      await expect(floating.locator(".preview-zoom-value")).toHaveText("100%");
      await expect(
        floating.getByRole("button", { name: "恢复到 100%" }),
      ).toBeDisabled();
      await floating.getByRole("button", { name: "缩小预览" }).click();
      const searchPanel = preview.getByRole("search");
      const panelBounds = (await searchPanel.boundingBox())!;
      const buttonBounds = (await side
        .getByRole("button", { name: "搜索文档" })
        .boundingBox())!;
      expect(
        Math.abs(
          panelBounds.y +
            panelBounds.height / 2 -
            buttonBounds.y -
            buttonBounds.height / 2,
        ),
      ).toBeLessThan(2);
      expect(
        sideBounds.x - panelBounds.x - panelBounds.width,
      ).toBeGreaterThanOrEqual(0);
      expect(sideBounds.x - panelBounds.x - panelBounds.width).toBeLessThan(12);
      await searchPanel.getByRole("textbox").fill("本地原件预览");
      await searchPanel.getByRole("textbox").press("Enter");
      await expect(searchPanel.locator(".preview-search-count")).not.toHaveText(
        "0/0",
      );
      await searchPanel.getByRole("button", { name: "关闭搜索" }).click();
      await expect(searchPanel).toHaveCount(0);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        side.getByRole("button", { name: "下载", exact: true }).click(),
      ]);
      expect(download.suggestedFilename()).toBe("rich.docx");
      await floating.getByRole("button", { name: "全屏", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => !!document.fullscreenElement))
        .toBe(true);
      await floating
        .getByRole("button", { name: "退出全屏", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => !!document.fullscreenElement))
        .toBe(false);
      await page.screenshot({ path: "../.local/split-tools-docx.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      const narrow = (await floating.boundingBox())!;
      expect(narrow.x).toBeGreaterThanOrEqual(0);
      expect(narrow.x + narrow.width).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect
        .poll(() =>
          preview
            .locator("img")
            .evaluateAll((nodes) =>
              nodes.some((node) => (node as HTMLImageElement).naturalWidth > 0),
            ),
        )
        .toBeTruthy();
      await page.getByRole("button", { name: "放大预览", exact: true }).click();
      await page.getByRole("button", { name: "缩小预览", exact: true }).click();
    } else if (name === "rich.pptx") {
      await expect(preview.locator("canvas,svg").first()).toBeVisible();
      await page.screenshot({ path: "../.local/file-viewer-rich-pptx.png" });
    } else {
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__paintedText.join(" ")),
        )
        .toContain("中文单元格");
      await preview.getByText("明细", { exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__paintedText.join(" ")),
        )
        .toContain("<script>alert(1)</script>");
      await expect(preview.locator("script")).toHaveCount(0);
      await page.screenshot({
        path: "../.local/file-viewer-multiple.xlsx.png",
      });
    }
  }
  expect(remote).toEqual([]);
});
