import { test, expect } from "@playwright/test";
test("全局分页：范围/总数、每页选择、请求与地址同步及紧凑间距", async ({
  page,
}) => {
  const user = {
    id: "user",
    username: "layout",
    display_name: "分页验收",
    is_active: true,
    is_superuser: true,
    must_change_password: false,
    permissions: [
      "create_project",
      "edit_items",
      "manage_items",
      "manage_members",
      "view_reports",
      "export",
    ],
    attachment_max_bytes: 10485760,
    attachment_extensions: [".txt"],
  };
  let empty = false;
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: index === 0 ? "project" : "row-" + (index + 1),
    name: "记录" + (index + 1),
    title: "记录" + (index + 1),
    code: "PAGE" + (index + 1),
    number: "PAGE-T-" + (index + 1),
    type: "task",
    status: "active",
    current_role: "admin",
    project: "project",
    user: user.id,
    display_name: "成员" + (index + 1),
    role: "admin",
    created_by: user.id,
    enabled: true,
    version: 1,
    details: {},
    permissions: [],
    created_at: "2026-10-20T00:00:00Z",
    updated_at: "2026-10-20T00:00:00Z",
  }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const size = Number(url.searchParams.get("page_size") || 20),
      current = Number(url.searchParams.get("page") || 1);
    let json: any = {
      items: empty ? [] : rows.slice((current - 1) * size, current * size),
      total: empty ? 0 : 100,
      page: current,
      page_size: size,
    };
    if (path.endsWith("/auth/me")) json = user;
    else if (/\/projects\/[^/]+$/.test(path)) json = rows[0];
    else if (path.includes("/reports/"))
      json = {
        total: 100,
        completed: 0,
        unfinished: 100,
        completion_rate: 0,
        states: [],
        bugs: [],
        members: rows.map((row) => ({
          name: row.name,
          unfinished: 1,
          overdue: 0,
          completed: 0,
        })),
      };
    await route.fulfill({ json });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const view of [
    "projects",
    "items",
    "iterations",
    "documents",
    "members",
    "categories",
    "recycle-bin",
    "users",
    "user-groups",
    "positions",
    "priorities",
    "home",
    "notifications",
  ]) {
    await page.goto(`/?view=${view}&project=project&type=task`);
    const pagination = page.locator(".ant-table-pagination");
    await expect(pagination).toContainText("第 1-20 条/总共 100 条");
    await expect(pagination.getByRole("combobox")).toBeVisible();
    const actionCell = page.locator(".ant-table-thead .table-actions-cell");
    const expectedWidth =
      view === "users"
        ? 240
        : view === "projects"
          ? 208
          : view === "notifications"
            ? 160
            : ["positions", "priorities", "categories", "user-groups"].includes(
                  view,
                )
              ? 180
              : 120;
    const geometry = await actionCell.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const viewport = node
        .closest(".ant-table-content")!
        .getBoundingClientRect();
      return {
        width: rect.width,
        right: viewport.right - rect.right,
        align: getComputedStyle(node).textAlign,
      };
    });
    expect(geometry.width).toBeCloseTo(expectedWidth, 0);
    expect(Math.abs(geometry.right)).toBeLessThanOrEqual(1);
    expect(geometry.align).toBe("right");
    await actionCell.evaluate((node) => {
      const viewport = node.closest(".ant-table-content")!;
      viewport.scrollLeft = viewport.scrollWidth;
    });
    await expect
      .poll(async () =>
        actionCell.evaluate((node) => {
          const viewport = node
            .closest(".ant-table-content")!
            .getBoundingClientRect();
          return Math.abs(viewport.right - node.getBoundingClientRect().right);
        }),
      )
      .toBeLessThanOrEqual(1);

    const spacing = await pagination.evaluate((node) => {
      const wrapper = node.closest(".ant-table-wrapper")!,
        table = wrapper.querySelector(".ant-table")!;
      return {
        top:
          node.getBoundingClientRect().top -
          table.getBoundingClientRect().bottom,
        bottom:
          wrapper.getBoundingClientRect().bottom -
          node.getBoundingClientRect().bottom,
      };
    });
    expect(spacing.top).toBe(12);
    expect(spacing.bottom).toBe(12);
  }
  await page.goto("/?view=positions&project=project");
  const pagination = page.locator(".ant-table-pagination");
  await expect(pagination).toContainText("第 1-20 条/总共 100 条");
  await pagination.getByTitle("2", { exact: true }).click();
  await expect(pagination).toContainText("第 21-40 条/总共 100 条");
  await pagination.getByRole("combobox").click();
  await page
    .locator(".ant-select-dropdown:visible")
    .getByText("50 条/页", { exact: true })
    .click();
  await expect(pagination).toContainText("第 1-50 条/总共 100 条");
  await expect(page.locator(".ant-table-tbody tr[data-row-key]")).toHaveCount(
    50,
  );
  expect(new URL(page.url()).searchParams.get("page_size")).toBe("50");
  expect(new URL(page.url()).searchParams.get("page")).toBe("1");
  await pagination.getByTitle("2", { exact: true }).click();
  await expect(pagination).toContainText("第 51-100 条/总共 100 条");
  await page.reload();
  await expect(pagination).toContainText("第 51-100 条/总共 100 条");
  await page.goto("/?view=positions&project=project&page_size=7");
  await expect(pagination).toContainText("第 1-20 条/总共 100 条");
  await page.goto("/?view=reports&project=project");
  const reportPagination = page.locator(".ant-table-pagination");
  await expect(reportPagination).toContainText("第 1-20 条/总共 100 条");
  await reportPagination.getByTitle("2", { exact: true }).click();
  await expect(reportPagination).toContainText("第 21-40 条/总共 100 条");
  empty = true;
  await page.goto("/?view=positions&project=project");
  await expect(
    page
      .locator(".ant-empty-description")
      .getByText("暂无数据", { exact: true }),
  ).toBeVisible();
});
