import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("UI-60 通知列表移除刷新及全部已读", async ({ page }) => {
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
  await page.goto("/?view=notifications");
  const heading = page.locator(".list-heading");
  const all = heading.getByRole("button", { name: "全部已读", exact: true });
  await expect(
    heading.getByRole("button", { name: "刷新", exact: true }),
  ).toHaveCount(0);
  await expect(all).toBeVisible();
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/me/notifications/mark-all-read") &&
      r.request().method() === "POST",
  );
  await all.click();
  expect((await response).ok()).toBeTruthy();
  await expect(
    page.getByRole("cell", { name: "未读", exact: true }),
  ).toHaveCount(0);
});
