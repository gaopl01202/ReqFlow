import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function api(page: Page, path: string, data?: unknown) {
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const response = await page.request.fetch("/api/v1/" + path, {
    method: data ? "POST" : "GET",
    data,
    headers: { "X-CSRFToken": token },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test("列表/卡片新建与查看：三类工作项新标签页打开，原页筛选和视图保留", async ({
  page,
}) => {
  test.setTimeout(120000);
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
  const project = await api(page, "projects", {
    name: "新窗口验收",
    code: "WIN" + Date.now(),
  });
  for (const [type, name] of [
    ["requirement", "需求"],
    ["task", "任务"],
    ["bug", "缺陷"],
  ]) {
    const item = await api(page, `projects/${project.id}/work-items`, {
      type,
      title: "源记录" + name,
      ...(type === "bug"
        ? { steps_to_reproduce: "点击", actual_result: "错误" }
        : {}),
    });
    for (const view of ["列表"]) {
      await page.goto(
        `/?view=items&project=${project.id}&type=${type}&q=${encodeURIComponent("源记录")}&page=1`,
      );
      const sourceLink = page.getByRole("link", {
        name: item.number,
        exact: true,
      });
      await expect(sourceLink).toBeVisible();
      const create = page.getByRole("link", {
        name: "新建" + name,
        exact: true,
      });
      await expect(create).toHaveAttribute("target", "_blank");
      const original = page.url();
      const [child] = await Promise.all([
        page.waitForEvent("popup"),
        create.click(),
      ]);
      await expect(child.getByLabel("标题", { exact: true })).toBeVisible();
      expect(page.url()).toBe(original);
      expect(new URL(child.url()).searchParams.get("project")).toBe(project.id);
      expect(new URL(child.url()).searchParams.get("item_type")).toBe(type);
      expect(await child.evaluate(() => window.opener === null)).toBeTruthy();
      await child
        .getByLabel("标题", { exact: true })
        .fill("新窗口保存" + name + view);
      await child
        .getByRole("button", { name: /^(创建|保存)$/, exact: true })
        .click();
      await expect(
        child.getByRole("heading", {
          name: "新窗口保存" + name + view,
          exact: true,
        }),
      ).toBeVisible();
      await child.close();
      expect(page.url()).toBe(original);
      await expect(sourceLink).toBeVisible();
      const [detail] = await Promise.all([
        page.waitForEvent("popup"),
        sourceLink.click(),
      ]);
      await expect(
        detail.getByRole("heading", { name: item.title, exact: true }),
      ).toBeVisible();
      expect(new URL(detail.url()).pathname).toBe(item.web_url);
      expect(page.url()).toBe(original);
      await detail.reload();
      await expect(
        detail.getByRole("heading", { name: item.title, exact: true }),
      ).toBeVisible();
      await detail.close();
      await expect(
        page.getByRole("searchbox", { name: "搜索", exact: true }),
      ).toHaveValue("源记录");
      expect(page.url()).toBe(original);
    }
  }
});
