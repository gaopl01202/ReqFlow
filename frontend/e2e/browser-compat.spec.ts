import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

async function command(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = "POST",
) {
  const token = (await (await request.get("/api/v1/auth/csrf")).json())
    .csrf_token;
  const response = await request.fetch("/api/v1/" + path, {
    method,
    headers: { "X-CSRFToken": token },
    data,
  });
  expect(response.ok(), path).toBeTruthy();
  return response.json();
}
async function oldBrowser(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Object, "hasOwn", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
}

for (const [kind, label] of [
  ["requirement", "需求"],
  ["task", "任务"],
  ["bug", "缺陷"],
]) {
  test(`缺少Object.hasOwn时：${label}列表、创建、编辑、描述评论及只读权限`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120000);
    const admin = await browser.newContext({ baseURL });
    const member = await browser.newContext({ baseURL });
    const reader = await browser.newContext({ baseURL });
    try {
      await command(admin.request, "auth/login", {
        username: "e2e-local",
        password: readFileSync(
          new URL("../../.local/e2e-password", import.meta.url),
          "utf8",
        ),
      });
      const suffix = Date.now();
      const project = await command(admin.request, "projects", {
        code: "COMPAT" + suffix,
        name: "旧浏览器" + label,
      });
      const meta = await command(
        admin.request,
        "workspace/context",
        undefined,
        "GET",
      );
      for (const [context, role] of [
        [member, "member"],
        [reader, "readonly"],
      ] as const) {
        const user = await command(admin.request, "users", {
          username: "compat-" + role + suffix,
          display_name: role === "member" ? "普通成员" : "只读成员",
          group: meta.groups.find((row: any) => row.name === "普通用户").id,
          position: meta.positions.find((row: any) => row.enabled).id,
        });
        await command(admin.request, `projects/${project.id}/members`, {
          user: user.id,
          role,
        });
        await command(context.request, "auth/login", {
          username: user.username,
          password: user.temporary_password,
        });
        await command(context.request, "auth/change-password", {
          password: `E2e-${randomUUID()}!`,
        });
      }
      const item = await command(
        admin.request,
        `projects/${project.id}/work-items`,
        {
          type: kind,
          title: "兼容" + label,
          description:
            "## 业务说明\n\n**重点内容**\n\n[链接](https://example.com)\n\n| 字段 | 值 |\n| --- | --- |\n| 类型 | 示例 |",
        },
      );
      await command(admin.request, `work-items/${item.id}/comments`, {
        body: "## 评论说明\n\n**评论重点** [参考](https://example.com)",
      });
      for (const [context, readonly] of [
        [admin, false],
        [member, false],
        [reader, true],
      ] as const) {
        await oldBrowser(context);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`/?view=items&project=${project.id}&type=${kind}`);
        await expect(
          page.getByRole("link", { name: item.number, exact: true }),
        ).toBeVisible();
        await page.goto(item.web_url);
        await expect(
          page.getByRole("heading", { name: item.title, exact: true }),
        ).toBeVisible();
        await expect(
          page
            .locator(".markdown")
            .getByText(readonly ? "加粗" : "重点内容", { exact: true }),
        ).toBeVisible();
        await expect(
          page.locator(".markdown").getByText("评论重点", { exact: true }),
        ).toBeVisible();
        if (!readonly)
          await expect(page.locator(".markdown table")).toBeVisible();
        expect(errors).toEqual([]);
        const semantics = await page.evaluate(() => {
          const inherited = Object.create({ inherited: 1 });
          inherited.own = undefined;
          const dictionary = Object.create(null);
          dictionary.hasOwnProperty = 1;
          const symbol = Symbol("key");
          dictionary[symbol] = true;
          return [
            Object.hasOwn(inherited, "own"),
            Object.hasOwn(inherited, "inherited"),
            Object.hasOwn(dictionary, "hasOwnProperty"),
            Object.hasOwn(dictionary, symbol),
            Object.hasOwn("abc", "1"),
            Object.prototype.propertyIsEnumerable.call(Object, "hasOwn"),
          ];
        });
        expect(semantics).toEqual([true, false, true, true, true, false]);
        await expect(
          page
            .locator(".item-titlebar")
            .getByRole("button", { name: "返回列表", exact: true }),
        ).toHaveCount(0);
        if (!readonly) {
          const edit = page
            .locator(".item-titlebar")
            .getByRole("button", { name: "编辑", exact: true });
          await expect(edit).toHaveText("编辑");
          await expect(edit).toHaveClass(/ant-btn-primary/);
        }
        if (readonly) {
          await expect(
            page.getByRole("button", { name: "编辑", exact: true }),
          ).toHaveCount(0);
          const denied = await context.request.patch(
            `/api/v1/work-items/${item.id}`,
            { data: { version: item.version, title: "越权修改" } },
          );
          expect(denied.status()).toBe(403);
        } else if (context === member) {
          await page.getByRole("button", { name: "编辑", exact: true }).click();
          await page
            .getByLabel("描述", { exact: true })
            .fill("编辑后正文 **加粗**");
          await page.getByRole("button", { name: "保存", exact: true }).click();
          await expect(
            page.locator(".markdown").getByText("加粗", { exact: true }),
          ).toBeVisible();
          await page.goto(`/?view=items&project=${project.id}&type=${kind}`);
          const href = await page
            .getByRole("link", { name: "新建" + label, exact: true })
            .getAttribute("href");
          await page.goto(href!);
          await page
            .getByLabel("标题", { exact: true })
            .fill("新建兼容" + label);
          await page
            .getByLabel("描述", { exact: true })
            .fill("新建正文 **新建加粗**");
          await page.getByRole("button", { name: "创建", exact: true }).click();
          await expect(
            page.getByRole("heading", {
              name: "新建兼容" + label,
              exact: true,
            }),
          ).toBeVisible();
          expect(errors).toEqual([]);
        }
        await page.close();
      }
    } finally {
      await admin.close();
      await member.close();
      await reader.close();
    }
  });
}
