import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("UI-59：工作台顺序、横向最近项目、待办大卡片及底部等高", async ({
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
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const projects = await (
    await page.request.get("/api/v1/projects?page_size=5")
  ).json();
  await page.evaluate(
    ({ id, ids }) =>
      localStorage.setItem("reqflow:recent:" + id, JSON.stringify(ids)),
    { id: me.id, ids: projects.items.map((row: any) => row.id) },
  );
  await page.goto("/?view=home");
  const recent = page.locator(".workbench-recents");
  const todo = page.locator(".workbench-todo-card");
  const bottom = page.locator(".workbench-bottom");
  await expect(recent.locator(".recent-project-card")).toHaveCount(
    projects.items.length,
  );
  await expect(
    todo.getByRole("heading", { name: "我负责的待办", exact: true }),
  ).toBeVisible();
  await expect(todo.getByRole("tab")).toHaveCount(3);
  await expect(todo.getByPlaceholder("搜索编号或标题")).toBeVisible();
  await expect(todo.getByRole("table")).toBeVisible();
  await expect(page.getByText("待办类型分布", { exact: true })).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
      };
    };
    return {
      metrics: rect(".workbench > .ant-row"),
      recent: rect(".workbench-recents"),
      todo: rect(".workbench-todo-card"),
      bottom: rect(".workbench-bottom"),
      projects: rect(".workbench-bottom .ant-col:first-child > .ant-card"),
      activity: rect(".workbench-bottom .workbench-activity"),
    };
  });
  expect(layout.recent.y).toBeGreaterThanOrEqual(layout.metrics.bottom);
  expect(layout.recent.width).toBeCloseTo(layout.todo.width, 0);
  expect(layout.todo.y).toBeGreaterThanOrEqual(layout.recent.bottom);
  expect(layout.bottom.y).toBeGreaterThanOrEqual(layout.todo.bottom);
  expect(layout.projects.height).toBe(layout.activity.height);
  expect(layout.projects.y).toBeCloseTo(layout.activity.y, 0);
  expect(layout.activity.x).toBeGreaterThan(layout.projects.x);
  await todo.getByRole("tab", { name: "今日到期", exact: true }).click();
  await expect(page).toHaveURL(/todo_scope=today/);
  const allRows = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/me/todos?") &&
      new URL(response.url()).searchParams.get("todo_scope") === "all",
  );
  await todo.getByRole("tab", { name: "全部待办", exact: true }).click();
  await allRows;
  await expect(todo.locator(".ant-spin-spinning")).toHaveCount(0);
  await page.locator(".content").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({
    path: "../.local/ui59-workbench-top.png",
    animations: "disabled",
  });
  await bottom.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../.local/ui59-workbench-bottom.png",
    animations: "disabled",
  });
});
