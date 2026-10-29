import { test, expect } from "@playwright/test";
test("全局筛选：重置始终可见、真实溢出展开、窗口变化和重置页码", async ({
  page,
}) => {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "layout",
    display_name: "筛选验收",
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
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "筛选验收",
    title: "筛选记录",
    code: "FLT",
    number: "FLT-T-1",
    type: "task",
    status: "active",
    status_name: "进行中",
    current_role: "admin",
    user: user.id,
    display_name: user.display_name,
    role: "admin",
    owner: user.id,
    created_by: user.id,
    priority_name: "中",
    enabled: true,
    version: 1,
    details: {},
    permissions: [],
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: any = { items: [row], total: 40, page: 1, page_size: 20 };
    if (path.endsWith("/auth/me")) json = user;
    else if (/\/projects\/[^/]+$/.test(path)) json = row;
    else if (path.includes("/reports/"))
      json = {
        total: 1,
        completed: 0,
        unfinished: 1,
        completion_rate: 0,
        states: [],
        members: [],
        bugs: [],
      };
    else if (path.endsWith("/board"))
      json = { columns: [{ code: "active", name: "进行中", items: [row] }] };
    await route.fulfill({ json });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const view of [
    "projects",
    "items",
    "board",
    "iterations",
    "documents",
    "members",
    "categories",
    "recycle-bin",
    "users",
    "user-groups",
    "positions",
    "reports",
    "home",
    "notifications",
  ]) {
    await page.goto(
      `/?view=${view}&project=${row.id}&type=task&q=${encodeURIComponent("待清理")}&page=2`,
    );
    const panel = page.locator(".filter-panel");
    const reset = panel.getByRole("button", { name: "重置", exact: true });
    const expectedSearch = [
      "items",
      "board",
      "recycle-bin",
      "reports",
      "home",
    ].includes(view)
      ? "搜索编号或标题"
      : (
          {
            projects: "搜索项目编码或名称",
            iterations: "搜索名称",
            documents: "搜索名称",
            members: "搜索成员账号或姓名",
            categories: "搜索分类名称",
            users: "搜索账号或姓名",
            "user-groups": "搜索用户组名称",
            positions: "搜索职务名称",
            notifications: "搜索通知内容",
          } as Record<string, string>
        )[view];
    await expect(panel.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      expectedSearch,
    );
    await expect(reset).toBeVisible();
    await expect(reset).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "重置筛选", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "展开筛选", exact: true }),
    ).toHaveCount(0);
    const search = panel.getByRole("button", { name: "搜索", exact: true });
    await expect(search).toBeVisible();
    const resetBox = await reset.boundingBox();
    const searchBox = await search.boundingBox();
    expect(searchBox!.x).toBeGreaterThan(resetBox!.x + resetBox!.width);
    const input = panel.getByRole("searchbox");
    await input.fill("尚未提交");
    expect(new URL(page.url()).searchParams.get("q")).toBe("待清理");
    await search.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe("尚未提交");
    await panel.locator(".ant-input-clear-icon").click();
    await expect(input).toHaveValue("");
    expect(new URL(page.url()).searchParams.get("q")).toBe("尚未提交");
    await search.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("");
    await reset.click();
    await expect(
      panel.getByRole("searchbox", { name: "搜索", exact: true }),
    ).toHaveValue("");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("page"))
      .toBe("1");
    await expect(reset).toBeVisible();
  }
  await page.goto(`/?view=items&project=${row.id}&type=task`);
  const panel = page.locator(".filter-panel");
  for (const width of [960, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const expand = panel.getByRole("button", { name: "展开", exact: true });
    await expect(expand).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "重置", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByPlaceholder("创建开始日期", { exact: true }),
    ).not.toBeInViewport();
    await expand.click();
    await expect(
      panel.getByPlaceholder("创建开始日期", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByPlaceholder("创建开始日期", { exact: true }),
    ).toBeInViewport();
    expect(
      await panel
        .locator(".filters > .ant-space-item")
        .evaluateAll((nodes) =>
          nodes.every((node) => !(node as HTMLElement).inert),
        ),
    ).toBeTruthy();
    await panel.getByRole("button", { name: "收起", exact: true }).click();
    await expect(
      panel.getByPlaceholder("创建开始日期", { exact: true }),
    ).not.toBeInViewport();
  }
  await page.setViewportSize({ width: 4000, height: 900 });
  await expect(
    panel.getByRole("button", { name: "展开", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "重置", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByPlaceholder("创建开始日期", { exact: true }),
  ).toBeInViewport();
  await page.setViewportSize({ width: 960, height: 900 });
  await expect(
    panel.getByRole("button", { name: "展开", exact: true }),
  ).toBeVisible();
});
