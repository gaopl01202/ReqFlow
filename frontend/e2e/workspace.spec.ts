import { followWorkPage } from "./work-page-navigation";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function login(page: Page) {
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
}
async function command(page: Page, path: string, data?: unknown) {
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
test("工作区：顶部项目快捷切换、通知、筛选折叠、仅列表、紧凑标签与等高报表", async ({
  page,
}) => {
  await login(page);
  const suffix = Date.now();
  const a = await command(page, "projects", {
    name: "导航验收甲" + suffix,
    code: "NAVA" + suffix,
    description: "项目简介验收",
  });
  const b = await command(page, "projects", {
    name: "导航验收乙" + suffix,
    code: "NAVB" + suffix,
  });
  await page.goto(`/?view=items&project=${a.id}`);
  await expect(page.getByLabel("工作项分类", { exact: true })).toBeVisible();
  await expect(page.locator(".sidebar .project-select")).toHaveCount(0);
  await expect(page.locator(".page-breadcrumb")).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "站内通知", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "故事墙 / 看板", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByPlaceholder("创建开始日期", { exact: true }),
  ).not.toBeInViewport();
  await page.getByRole("button", { name: "展开" }).click();
  await expect(
    page.getByPlaceholder("创建开始日期", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收起" }).click();
  await expect(
    page.getByRole("button", { name: "详情", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".list-heading")
      .getByRole("tab", { name: "任务", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("当前项目", { exact: true }).fill(b.name);
  await expect(
    page
      .locator(".ant-select-dropdown:visible .ant-select-item-option")
      .filter({ hasText: b.name }),
  ).toBeVisible();
  await page.getByLabel("当前项目", { exact: true }).press("ArrowDown");
  await page.getByLabel("当前项目", { exact: true }).press("Enter");
  await expect(page).toHaveURL(new RegExp("project=" + b.id));
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "站内通知", exact: true }).click();
  await expect(page).toHaveURL(/view=notifications/);
  await page.getByRole("menuitem", { name: "工作项", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.reload();
  await expect(page.locator(".board")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "工作台", exact: true }).click();
  const card = page.locator(".recent-project-card").filter({ hasText: b.name });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 位成员");
  await card.click();
  await page.getByRole("menuitem", { name: "统计报表", exact: true }).click();
  const heights = await page
    .locator(".ant-row")
    .first()
    .locator(".ant-card")
    .evaluateAll((cards) => cards.map((c) => c.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
  await page.screenshot({ path: "../.local/workspace-reports.png" });
});
test("富文本与文档：粘贴图片、创建附件、Markdown可视化、编辑和刷新", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  const suffix = Date.now();
  const project = await command(page, "projects", {
    name: "编辑器验收" + suffix,
    code: "EDIT" + suffix,
  });
  await page.goto(`/?view=items&project=${project.id}&type=task`);
  await followWorkPage(page, page.getByRole("link", { name: "新建任务" }));
  const work = page.locator(".work-page");
  await work.getByLabel("标题", { exact: true }).fill("图文任务");
  await work.getByLabel("描述", { exact: true }).fill("图片与附件应一起保存");
  await work.getByLabel("描述", { exact: true }).focus();
  await page.evaluate((bytes) => {
    const file = new File([Uint8Array.from(bytes)], "粘贴截图.png", {
      type: "image/png",
    });
    const data = new DataTransfer();
    data.items.add(file);
    document.querySelector(".vditor-ir .vditor-reset")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, Array.from(image));
  await expect(work.locator(".vditor-ir .vditor-reset img")).toBeVisible();
  await work.locator(".pending-attachments input[type=file]").setInputFiles({
    name: "说明.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附件内容"),
  });
  await expect(work.locator(".pending-attachments")).toContainText("说明.txt");
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "图文任务", exact: true }),
  ).toBeVisible();
  await expect(work.locator(".markdown img")).toBeVisible();
  expect(
    await work
      .locator(".markdown img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  ).toBeTruthy();
  await expect(
    work.getByRole("button", { name: "折叠附件", exact: true }),
  ).toBeVisible();
  await expect(
    work.getByRole("link", { name: "说明.txt", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(work.locator(".markdown img")).toBeVisible();
  await work.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(work.locator(".vditor-ir .vditor-reset img")).toBeVisible();
  await work.getByLabel("标题", { exact: true }).fill("图文任务修改");
  await work
    .getByRole("button", { name: /^(创建|保存)$/, exact: true })
    .click();
  await expect(
    work.getByRole("heading", { name: "图文任务修改", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../.local/workspace-detail.png" });
  await page.getByRole("menuitem", { name: "项目文档", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "新建文件夹", exact: true }),
  ).toBeVisible();
  await page.locator('.list-heading input[type="file"]').setInputFiles({
    name: "Markdown说明.md",
    mimeType: "text/plain",
    buffer: Buffer.from("# 文档标题\n\n重点说明"),
  });
  await expect(
    page.getByRole("link", { name: "Markdown说明.md", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("工作项创建：撑满描述、右侧附件、草稿恢复与连续创建", async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const project = await command(page, "projects", {
    name: "创建布局" + suffix,
    code: "CREATE" + suffix,
  });
  for (const kind of ["requirement", "task", "bug"]) {
    await page.goto(
      `/?view=items&project=${project.id}&type=${kind}&item_type=${kind}&item_mode=create`,
    );
    const work = page.locator(".work-page");
    await expect(
      work.getByRole("button", { name: "创建", exact: true }),
    ).toBeVisible();
    await expect(work.locator(".form-footer button")).toHaveCount(4);
    await expect(
      work.locator(".work-editor-title .work-type-badge"),
    ).toHaveText({ requirement: "需求", task: "任务", bug: "缺陷" }[kind]!);
    await work.getByLabel("标题", { exact: true }).fill(kind + "草稿");
    await work.getByLabel("描述", { exact: true }).fill("保存草稿后恢复正文");
    await work.locator(".editor-properties input[type=file]").setInputFiles({
      name: "草稿.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("draft"),
    });
    await work.getByLabel("描述", { exact: true }).focus();
    await page.evaluate((bytes) => {
      const file = new File([Uint8Array.from(bytes)], "粘贴截图.png", {
        type: "image/png",
      });
      const data = new DataTransfer();
      data.items.add(file);
      document.querySelector(".vditor-ir .vditor-reset")!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, Array.from(image));
    await expect(work.locator(".vditor-ir img")).toBeVisible();
    await work.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      page.getByText("草稿已保存到当前浏览器", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(work.getByLabel("标题", { exact: true })).toHaveValue(
      kind + "草稿",
    );
    await expect(
      work.locator(".editor-properties .pending-attachments"),
    ).toContainText("草稿.txt");
    await expect(work.getByLabel("描述", { exact: true })).toContainText(
      "保存草稿后恢复正文",
    );
    await expect(work.locator(".vditor-ir img")).toBeVisible();
    await expect
      .poll(() =>
        work
          .locator(".vditor-ir img")
          .evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
      )
      .toBeTruthy();
    const editor = (await work
      .locator(".markdown-editor.vditor")
      .boundingBox())!;
    const main = (await work.locator(".editor-main").boundingBox())!;
    expect(
      Math.abs(editor.y + editor.height - main.y - main.height),
    ).toBeLessThan(4);
    await work
      .getByRole("button", { name: "提交并继续创建", exact: true })
      .click();
    await expect(
      page.getByText("创建成功，可继续创建", { exact: true }),
    ).toBeVisible();
    await expect(work.getByLabel("标题", { exact: true })).toHaveValue("");
    await expect(work.locator(".pending-attachments")).not.toContainText(
      "草稿.txt",
    );
    await page.reload();
    await expect(work.getByLabel("标题", { exact: true })).toHaveValue("");
    await work.getByLabel("标题", { exact: true }).fill(kind + "创建");
    await work.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      work.getByRole("heading", { name: kind + "创建", exact: true }),
    ).toBeVisible();
  }
});
