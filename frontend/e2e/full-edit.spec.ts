import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function command(page: Page, path: string, data?: unknown) {
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const response = await page.request.fetch("/api/v1/" + path, {
    method: data ? "POST" : "GET",
    data,
    headers: { "X-CSRFToken": csrf },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function choose(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).fill(text);
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: text })
    .click();
}
test("各入口详情完整编辑：看板需求、工作台任务、列表缺陷的描述、属性、日期、专属字段及附件", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const suffix = Date.now();
  const user = await command(page, "auth/me");
  const project = await command(page, "projects", {
    name: "完整编辑验收",
    code: "EDITALL" + suffix,
  });
  const category = await command(page, `projects/${project.id}/categories`, {
    name: "编辑分类" + suffix,
  });
  const priority = await command(page, `projects/${project.id}/dictionaries`, {
    kind: "priority",
    name: "编辑优先级" + suffix,
    color: "purple",
  });
  const iteration = await command(page, `projects/${project.id}/iterations`, {
    name: "编辑迭代" + suffix,
    owner: user.id,
    start_date: "2030-10-20",
    end_date: "2030-10-30",
  });
  const requirement = await command(page, `projects/${project.id}/work-items`, {
    type: "requirement",
    title: "原需求",
    description: "原描述",
  });
  const task = await command(page, `projects/${project.id}/work-items`, {
    type: "task",
    title: "原任务",
  });
  const bug = await command(page, `projects/${project.id}/work-items`, {
    type: "bug",
    title: "原缺陷",
    steps_to_reproduce: "原步骤",
    actual_result: "原结果",
  });
  for (const [view, item, name] of [
    ["board", requirement, "需求"],
    ["home", task, "任务"],
    ["items", bug, "缺陷"],
  ] as const) {
    await page.goto(
      `/?view=${view}&project=${project.id}&type=${item.type}&item_mode=detail&item_id=${item.id}&item_type=${item.type}`,
    );
    const work = page.locator(".work-page");
    await expect(
      work.getByRole("heading", { name: item.title, exact: true }),
    ).toBeVisible();
    await work.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(work.locator(".editor-properties")).toBeVisible();
    await expect(work.getByLabel("标题", { exact: true })).toHaveValue(
      item.title,
    );
    await work.getByLabel("标题", { exact: true }).fill("修改后的" + name);
    await work
      .getByLabel("描述", { exact: true })
      .fill("完整修改" + name + "描述");
    await choose(page, "优先级", priority.name);
    await choose(page, "负责人", user.display_name);
    await choose(page, "分类", category.name);
    await choose(page, "迭代", iteration.name);
    await work.getByLabel("计划开始日期", { exact: true }).fill("2030-10-21");
    await work.getByLabel("计划开始日期", { exact: true }).press("Enter");
    await work.getByLabel("截止日期", { exact: true }).fill("2030-10-24");
    await work.getByLabel("截止日期", { exact: true }).press("Enter");
    if (item.type === "requirement") {
      await choose(page, "来源", "用户反馈");
      await work.getByLabel("提出人", { exact: true }).fill("客户甲");
    }
    if (item.type === "task") await choose(page, "关联需求", "修改后的需求");
    if (item.type === "bug") {
      await choose(page, "环境", "测试环境");
      await choose(page, "严重程度", "严重");
      await choose(page, "关联需求", "修改后的需求");
      await choose(page, "关联任务", "修改后的任务");
    }
    await work.locator(".pending-attachments input[type=file]").setInputFiles({
      name: name + "编辑附件.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("编辑页新增附件"),
    });
    await work
      .getByRole("button", { name: /^(创建|保存)$/, exact: true })
      .click();
    await expect(
      work.getByRole("heading", { name: "修改后的" + name, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new URL(item.web_url, page.url()).href);
    const saved = await command(page, "work-items/" + item.id);
    expect(saved.description).toContain("完整修改" + name + "描述");
    expect(saved.priority).toBe(priority.id);
    expect(saved.assignee).toBe(user.id);
    expect(saved.category).toBe(category.id);
    expect(saved.iteration).toBe(iteration.id);
    expect(saved.planned_start_date).toBe("2030-10-21");
    expect(saved.due_date).toBe("2030-10-24");
    if (item.type === "requirement") {
      expect(saved.details.source).toBe("feedback");
      expect(saved.details.proposer).toBe("客户甲");
      expect(saved.details.acceptance_criteria).toBe("");
      expect(saved.details.expected_finish_date).toBeNull();
    }
    if (item.type === "task")
      expect(saved.details.requirement).toBe(requirement.id);
    if (item.type === "bug") {
      expect(saved.details.steps_to_reproduce).toBe("原步骤");
      expect(saved.details.actual_result).toBe("原结果");
      expect(saved.details.expected_result).toBe("");
      expect(saved.details.environment).toBe("testing");
      expect(saved.details.severity).toBe("major");
      expect(saved.details.requirement).toBe(requirement.id);
      expect(saved.details.task).toBe(task.id);
    }
    await expect(
      work.getByRole("link", { name: name + "编辑附件.txt", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      work.getByRole("heading", { name: "修改后的" + name, exact: true }),
    ).toBeVisible();
    await work.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(work.getByLabel("描述", { exact: true })).toContainText(
      "完整修改" + name + "描述",
    );
    // Refresh the /edit deep link so cancellation cannot depend on the previous detail state.
    await page.reload();
    await expect(work.getByLabel("标题", { exact: true })).toHaveValue(
      "修改后的" + name,
    );
    await work.getByLabel("标题", { exact: true }).fill("不应保存的标题");
    await work
      .locator(".pending-attachments input[type=file]")
      .setInputFiles({
        name: "取消附件.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("不应上传"),
      });
    await work.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page).toHaveURL(new URL(item.web_url, page.url()).href);
    await expect(
      work.getByRole("heading", { name: "修改后的" + name, exact: true }),
    ).toBeVisible();
    await expect(
      work.getByRole("link", { name: "取消附件.txt", exact: true }),
    ).toHaveCount(0);
    expect((await command(page, "work-items/" + item.id)).title).toBe(
      "修改后的" + name,
    );
  }
  expect(errors).toEqual([]);
});
