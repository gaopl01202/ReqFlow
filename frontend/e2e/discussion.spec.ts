import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function api(page: Page, path: string, data?: unknown) {
  const token = (await (await page.request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const r = await page.request.fetch("/api/v1/" + path, {
    method: data ? "POST" : "GET",
    data,
    headers: { "X-CSRFToken": token },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test("详情协作：附件折叠、富文本评论增改删、状态快照和多处理人流转", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGE ERROR", e.message);
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
  const me = await api(page, "auth/me");
  const project = await api(page, "projects", {
    name: "详情协作验收",
    code: "DSC" + Date.now(),
  });
  const other = await api(page, "users", {
    username: "discussion-member-" + Date.now(),
    display_name: "协作处理人",
    group: me.group,
    position: me.position,
  });
  await api(page, `projects/${project.id}/members`, {
    user: other.id,
    role: "member",
  });
  for (const type of ["requirement", "task", "bug"]) {
    const item = await api(page, `projects/${project.id}/work-items`, {
      type,
      title: "详情协作" + type,
      ...(type === "bug"
        ? { steps_to_reproduce: "点击", actual_result: "失败" }
        : {}),
    });
    await page.goto(
      `/?view=items&project=${project.id}&type=${type}&item_mode=detail&item_type=${type}&item_id=${item.id}`,
    );
    const work = page.locator(".work-page");
    await expect(
      work.getByRole("heading", { name: item.title, exact: true }),
    ).toBeVisible();
    await expect(work.locator(".history-row")).toHaveCount(0);
    await expect(
      work.getByRole("button", { name: "折叠操作记录", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await work
      .getByRole("button", { name: "折叠操作记录", exact: true })
      .click();
    await expect(work.locator(".history-row").first()).toBeVisible();
    await work
      .getByRole("button", { name: "折叠操作记录", exact: true })
      .click();
    await expect(work.locator(".history-row")).toHaveCount(0);
    const description = await work
      .locator(".detail-description")
      .evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        top: getComputedStyle(node).paddingTop,
        bottom: getComputedStyle(node).paddingBottom,
      }));
    expect(
      await work
        .locator(".detail-description")
        .evaluate(
          (node) =>
            node.querySelector(".markdown")!.getBoundingClientRect().top -
            node.getBoundingClientRect().top,
        ),
    ).toBe(12);
    expect(description.top).toBe("12px");
    expect(description.bottom).toBe("12px");
    expect(description.height).toBeLessThan(80);
    await expect(
      work.getByRole("textbox", { name: "流转评论", exact: true }),
    ).toBeVisible();
    expect(
      (await work
        .locator(".workflow-comment .markdown-editor-shell")
        .boundingBox())!.height,
    ).toBeLessThan(240);
    await work.locator(".detail-attachments input[type=file]").setInputFiles({
      name: type + ".txt",
      mimeType: "text/plain",
      buffer: Buffer.from("文件"),
    });
    const file = work
      .locator(".attachment-file")
      .filter({ hasText: type + ".txt" });
    await expect(file).toContainText(me.display_name);
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      file.locator(".attachment-name").click(),
    ]);
    await expect(preview.locator(".unified-file-preview")).toHaveAttribute(
      "data-preview-ready",
      "true",
      { timeout: 45000 },
    );
    await expect(
      preview.getByRole("heading", { name: type + ".txt", exact: true }),
    ).toBeVisible();
    await expect(preview.locator(".unified-file-preview")).toContainText(
      "文件",
    );
    const closed = preview.waitForEvent("close");
    await preview.getByRole("button", { name: "关闭", exact: true }).click();
    await closed;

    await expect(
      file.getByRole("button", { name: "删除附件 " + type + ".txt" }),
    ).toBeVisible();
    await expect(
      file.getByRole("link", { name: "下载附件 " + type + ".txt" }),
    ).toBeVisible();
    await work.getByRole("button", { name: "折叠附件", exact: true }).click();
    await expect(file).toHaveCount(0);
    await work.getByRole("button", { name: "折叠附件", exact: true }).click();
    await expect(file).toBeVisible();
    await work.getByRole("button", { name: "添加评论", exact: true }).click();
    const editor = work.getByRole("textbox", { name: "评论内容", exact: true });
    const composer = work.locator(".comment-composer");
    const inputBox = (await composer
      .locator(".markdown-editor-shell")
      .boundingBox())!;
    const buttonsBox = (await composer
      .locator(":scope > .ant-space")
      .boundingBox())!;
    expect(inputBox.height).toBeLessThan(240);
    expect(buttonsBox.y - inputBox.y - inputBox.height).toBeLessThanOrEqual(10);
    await editor.fill("**富文本评论**");
    await editor.press("Enter");
    await editor.evaluate((node) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        ),
        (c) => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([bytes], "comment.png", { type: "image/png" }));
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await work.getByRole("button", { name: "发送评论", exact: true }).click();
    const row = work.locator(".comment-row").filter({ hasText: "富文本评论" });
    await expect(
      row.locator("strong").filter({ hasText: "富文本评论" }),
    ).toBeVisible();
    await expect(row.locator("img")).toBeVisible();
    expect(
      await row.evaluate(
        (node) =>
          node
            .querySelector(".markdown > :first-child")!
            .getBoundingClientRect().top -
          node.querySelector(".comment-heading")!.getBoundingClientRect()
            .bottom,
      ),
    ).toBeLessThanOrEqual(8);
    await expect(row.locator(".comment-heading")).toContainText(
      item.status_name,
    );
    await expect(work.getByLabel("评论通知成员")).toHaveCount(0);
    await work.getByRole("button", { name: "折叠评论", exact: true }).click();
    await expect(row).toHaveCount(0);
    await work.getByRole("button", { name: "折叠评论", exact: true }).click();
    await row.getByRole("button", { name: "编辑评论", exact: true }).click();
    await work
      .getByRole("textbox", { name: "编辑评论内容", exact: true })
      .fill("**修改后的评论**");
    expect(
      (await work
        .locator(".comment-composer .markdown-editor-shell")
        .boundingBox())!.height,
    ).toBeLessThan(240);
    await work.getByRole("button", { name: "保存评论", exact: true }).click();
    const changed = work
      .locator(".comment-row")
      .filter({ hasText: "修改后的评论" });
    await expect(changed).toBeVisible();
    const next =
      type === "task" ? "进行中" : type === "bug" ? "待修复" : "待开始";
    await work
      .locator(".detail-workflow .workflow-stages")
      .getByText(next, { exact: true })
      .click();
    await expect(work.locator(".workflow-footer button")).toBeDisabled();
    await work.getByLabel("流转处理人", { exact: true }).click();
    for (const name of [me.display_name, other.display_name])
      await page
        .locator(".ant-select-dropdown:visible")
        .getByText(name, { exact: true })
        .click();
    await work.getByLabel("流转处理人", { exact: true }).press("Escape");
    await work
      .getByRole("textbox", { name: "流转评论", exact: true })
      .fill("**开始协作**");
    await expect(work.getByLabel("流转原因")).toHaveCount(0);
    await expect(work.getByLabel("流转通知成员")).toHaveCount(0);
    await expect(work.getByText("存在未完成关联任务时确认继续")).toHaveCount(0);
    await work.getByRole("button", { name: "确认流转", exact: true }).click();
    await expect(
      work.locator(
        '.item-detail-right .metadata-row:has(dt:text-is("状态")) .ant-tag',
      ),
    ).toHaveText(next);
    const saved = await api(page, "work-items/" + item.id);
    expect(saved.handlers).toEqual(expect.arrayContaining([me.id, other.id]));
    expect(saved.handlers).toHaveLength(2);
    await expect(changed.locator(".comment-heading")).toContainText(
      item.status_name,
    );
    await expect(
      work
        .locator(".comment-row")
        .filter({ hasText: "开始协作" })
        .locator(".comment-heading"),
    ).toContainText(next);
    await expect(work.locator(".comment-row").first()).toContainText(
      "开始协作",
    );
    await page.reload();
    await expect(work.locator(".item-detail-right")).toContainText(
      other.display_name,
    );
    await changed
      .getByRole("button", { name: "删除评论", exact: true })
      .click();
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await expect(changed).toHaveCount(0);
    if (type === "requirement")
      await page.screenshot({ path: "../.local/discussion-detail.png" });
  }
  expect(errors).toEqual([]);
});
