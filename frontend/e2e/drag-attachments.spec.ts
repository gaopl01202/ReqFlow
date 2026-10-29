import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("工作项页面拖拽附件：新建暂存、混合校验、详情上传、文本拖拽不拦截", async ({
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
  const response = await page.request.post("/api/v1/projects", {
    headers: { "X-CSRFToken": csrf },
    data: { name: "拖拽附件验收", code: "DROP" + Date.now() },
  });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(
    `/?view=items&project=${project.id}&type=task&item_mode=create&item_type=task`,
  );
  const work = page.locator(".work-page");
  await work.getByLabel("标题", { exact: true }).fill("页面拖拽附件");
  await expect(work.locator(".attachment-picker-hint")).toContainText(
    "单文件 ≤ 10 MB",
  );
  await expect(work.locator(".pending-attachments")).not.toContainText(
    "支持格式",
  );
  await page.screenshot({
    path: "../.local/ui72-create.png",
    animations: "disabled",
  });
  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["正文"], "拖拽A.txt", { type: "text/plain" }));
    transfer.items.add(new File(["正文"], "拒绝.exe"));
    transfer.items.add(new File(["正文"], "拖拽B.txt", { type: "text/plain" }));
    return transfer;
  });
  await page
    .locator(".editor-main")
    .dispatchEvent("dragenter", { dataTransfer: data });
  await expect(page.getByRole("status")).toContainText("松开鼠标");
  await page
    .locator(".editor-main")
    .dispatchEvent("drop", { dataTransfer: data });
  await expect(page.locator(".attachment-drop-overlay")).toHaveCount(0);
  await expect(
    work.locator(".pending-file-list .pending-attachment-file"),
  ).toHaveCount(2);
  await expect(
    page.getByText("拒绝.exe：不支持此附件类型", { exact: true }),
  ).toBeVisible();
  await work.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    work.getByRole("heading", { name: "页面拖拽附件", exact: true }),
  ).toBeVisible();
  await expect(work.locator(".attachment-list .attachment-file")).toHaveCount(
    2,
  );
  const extra = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["图片内容"], "独立图片.png", { type: "image/png" }),
    );
    transfer.items.add(
      new File(["详情内容"], "详情拖拽.txt", { type: "text/plain" }),
    );
    return transfer;
  });
  await work
    .locator(".item-titlebar")
    .dispatchEvent("drop", { dataTransfer: extra });
  await expect(work.locator(".attachment-list .attachment-file")).toHaveCount(
    4,
  );
  await expect(work.locator(".detail-description img")).toHaveCount(0);
  const prevented = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "普通文字");
    return !window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, cancelable: true }),
    );
  });
  expect(prevented).toBe(false);
  await page.screenshot({
    path: "../.local/ui72-detail.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(work.locator(".attachment-list .attachment-file")).toHaveCount(
    4,
  );
  await expect(
    work.getByRole("link", { name: "独立图片.png", exact: true }),
  ).toBeVisible();
});
