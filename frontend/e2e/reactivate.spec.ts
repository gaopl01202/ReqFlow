import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("UI-56：类型标识、统一工作流选择、三类型叶节点重新激活", async ({
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
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const headers = { "X-CSRFToken": csrf };
  const call = async (path: string, data?: any, method = "POST") => {
    const response = await page.request.fetch(`/api/v1/${path}`, {
      method: data ? method : "GET",
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const user = await call("auth/me");
  const project = await call("projects", {
    code: "REOPEN" + Date.now(),
    name: "重新激活验收",
  });
  const definition = await call(`projects/${project.id}/workflow`);
  for (const spec of Object.values(definition.workflow) as any[]) {
    const terminal = spec.states
      .filter((state: any) => state.category !== "pending")
      .map((state: any) => state.code);
    spec.transitions = spec.transitions.filter(
      (edge: any) => !terminal.includes(edge.from),
    );
  }
  await call(
    `projects/${project.id}/workflow`,
    { version: project.version, workflow: definition.workflow },
    "PATCH",
  );
  for (const [type, name, color, path] of [
    ["requirement", "需求", "blue", ["ready", "active", "review", "done"]],
    ["task", "任务", "green", ["active", "review", "done"]],
    ["bug", "缺陷", "red", ["ready", "active", "review", "closed"]],
  ] as const) {
    await page.goto(
      `/?view=items&project=${project.id}&type=${type}&item_mode=create&item_type=${type}`,
    );
    await expect(page.locator(`.work-type-badge.ant-tag-${color}`)).toHaveText(
      name,
    );
    await expect(page.locator(".work-editor-title .ant-tag")).toHaveCount(1);
    let item = await call(`projects/${project.id}/work-items`, {
      type,
      title: "重新激活" + name,
      assignee: user.id,
    });
    for (const state of path)
      item = await call(`work-items/${item.id}/transition`, {
        version: item.version,
        target_status: state,
        handlers: [user.id],
      });
    await page.goto(
      `/?view=items&project=${project.id}&type=${type}&item_mode=detail&item_id=${item.id}&item_type=${type}`,
    );
    await expect(
      page.locator(`.item-titlebar .work-type-badge.ant-tag-${color}`),
    ).toHaveText(name);
    await expect(
      page.getByRole("button", { name: "确认流转", exact: true }),
    ).toHaveCount(0);
    const footer = page.locator(".workflow-footer");
    await expect(
      footer.getByRole("button", { name: "重新激活", exact: true }),
    ).toBeInViewport();
    await footer.getByRole("button", { name: "重新激活", exact: true }).click();
    if (type === "requirement") {
      await expect(
        footer.getByRole("button", { name: "确认重新激活", exact: true }),
      ).toBeDisabled();
      await footer.getByRole("button", { name: "取消", exact: true }).click();
      expect((await call(`work-items/${item.id}`)).version).toBe(item.version);
      await footer
        .getByRole("button", { name: "重新激活", exact: true })
        .click();
    }
    const stages = page.getByRole("group", {
      name: "重新激活状态",
      exact: true,
    });
    await expect(stages.locator(".ant-tag")).toHaveCount(0);
    await expect(
      stages.getByRole("button", { name: "已完成", exact: true }),
    ).toHaveCount(0);
    const target = stages.getByRole("button", {
      name: type === "bug" ? "修复中" : "进行中",
      exact: true,
    });
    await target.click();
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await page
      .getByLabel("流转评论", { exact: true })
      .fill("**重新处理**：补充回归验证");
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect(target).toHaveCSS("background-color", "rgb(230, 244, 255)");
    if (type === "requirement")
      await page.screenshot({ path: "../.local/reactivate-workflow.png" });
    await footer
      .getByRole("button", { name: "确认重新激活", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "重新激活", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => (await call(`work-items/${item.id}`)).status)
      .toBe("active");
    const updated = await call(`work-items/${item.id}`);
    expect(updated.status_category).toBe("pending");
    expect(updated.completed_at).toBeNull();
    await expect(
      page.locator(
        '.item-detail-right .metadata-row:has(dt:text-is("状态")) .ant-tag',
      ),
    ).toHaveText(type === "bug" ? "修复中" : "进行中");
    await expect(
      footer.getByRole("button", { name: "确认流转", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "折叠操作记录", exact: true })
      .click();
    await expect(page.locator(".history-list")).toContainText("重新激活");
    await expect(page.locator(".detail-discussion")).toContainText(
      "补充回归验证",
    );
  }
});
