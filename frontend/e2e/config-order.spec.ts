import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const module of ["positions"]) {
  test(`${module}：无排序字段，拖动保存、刷新保留与失败反馈`, async ({
    page,
  }) => {
    const prefix = (module === "positions" ? "职务" : "优先") + Date.now();
    const created: string[] = [];
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
    async function request(path: string, method = "GET", data?: unknown) {
      const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
        .csrf_token;
      const response = await page.request.fetch("/api/v1/" + path, {
        method,
        data,
        headers: { "X-CSRFToken": token },
      });
      expect(response.ok()).toBeTruthy();
      return response.status() === 204 ? null : response.json();
    }
    const row = (name: string) =>
      page
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name, exact: true }) });
    const order = async () =>
      (await request(module + "?page_size=100")).items.map(
        (item: { id: string }) => item.id,
      );
    try {
      const first = await request(module, "POST", { name: prefix + "甲" });
      created.push(first.id);
      const second = await request(module, "POST", { name: prefix + "乙" });
      created.push(second.id);
      await page
        .getByRole("menuitem", {
          name: module === "positions" ? "职务管理" : "优先级配置",
          exact: true,
        })
        .click();
      await expect(row(second.name)).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "排序", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "新建", exact: true }).click();
      const dialog = page.locator(".ant-modal:visible");
      await expect(dialog.getByLabel("排序", { exact: true })).toHaveCount(0);
      await dialog.getByLabel("名称", { exact: true }).fill(prefix + "丙");
      const createResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/" + module) &&
          r.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      const third = await (await createResponse).json();
      created.push(third.id);
      await expect(dialog).toHaveCount(0);
      await expect(row(third.name)).toBeVisible();
      expect((await order()).at(-1)).toBe(third.id);
      await row(first.name)
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      await expect(dialog.getByLabel("排序", { exact: true })).toHaveCount(0);
      await dialog.getByLabel("名称", { exact: true }).fill(prefix + "改");
      await dialog.getByRole("button", { name: "确定", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(row(prefix + "改")).toBeVisible();
      const saved = page.waitForResponse((r) =>
        r.url().endsWith(`/${module}/reorder`),
      );
      await page
        .getByRole("button", { name: "拖动排序 " + third.name, exact: true })
        .dragTo(row(prefix + "改"), { targetPosition: { x: 100, y: 5 } });
      expect((await saved).status()).toBe(200);
      const ids = await order();
      expect(ids.indexOf(third.id)).toBeLessThan(ids.indexOf(first.id));
      await page.reload();
      await expect(row(third.name)).toBeVisible();
      expect(await order()).toEqual(ids);
      const visibleNames = await page
        .locator(".ant-table-tbody tr[data-row-key] td:nth-child(2)")
        .allTextContents();
      expect(visibleNames.indexOf(third.name)).toBeLessThan(
        visibleNames.indexOf(prefix + "改"),
      );
      await page.route(
        `**/api/v1/${module}/reorder`,
        (route) =>
          route.fulfill({
            status: 409,
            json: {
              code: "CONFLICT",
              message: "数据已更新，请刷新后重试",
              fields: {},
              request_id: "test",
            },
          }),
        { times: 1 },
      );
      await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
      const rejected = page.waitForResponse((response) =>
        response.url().endsWith(`/${module}/reorder`),
      );
      // The first move above verifies native dragging. Use the supported keyboard
      // action here to isolate the failure response from native drag timing.
      await page
        .getByRole("button", { name: "拖动排序 " + third.name, exact: true })
        .press("ArrowDown");
      expect((await rejected).status()).toBe(409);
      await expect(
        page.getByText("数据已更新，请刷新后重试").first(),
      ).toBeVisible();
      expect(await order()).toEqual(ids);
      await page.getByRole("searchbox", { name: "搜索" }).fill(prefix);
      await expect(
        page.getByRole("button", {
          name: "拖动排序 " + third.name,
          exact: true,
        }),
      ).toHaveAttribute("draggable", "false");
    } finally {
      const items = (await request(module + "?page_size=100")).items;
      for (const item of items.filter((item: { id: string }) =>
        created.includes(item.id),
      ))
        await request(module + "/" + item.id, "DELETE", {
          version: item.version,
        });
    }
  });
}
