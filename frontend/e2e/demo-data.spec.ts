import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("DEV-01：长期模拟数据的列表、图片附件与文档", async ({ page }) => {
  test.skip(!process.env.DEMO_DATA_BATCH, "需要显式指定本地模拟数据批次");
  test.setTimeout(120000);
  const batch = process.env.DEMO_DATA_BATCH!;
  if (!/^[a-z][a-z0-9_-]{2,14}$/.test(batch))
    throw new Error("Invalid demo batch");
  const root = new URL(`../../.local/demo-data/${batch}/`, import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", root), "utf8"),
  );
  const credentials = JSON.parse(
    readFileSync(new URL("credentials.json", root), "utf8"),
  );
  const project = manifest.projects[0];
  await page.goto("/");
  await page
    .getByLabel("登录账号", { exact: true })
    .fill(credentials[0].username);
  await page.getByLabel("密码", { exact: true }).fill(credentials[0].password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("最近访问项目", { exact: true })).toBeVisible();
  for (const type of ["requirement", "task", "bug"]) {
    const response = await page.request.get(
      `/api/v1/projects/${project.id}/work-items?type=${type}&page_size=20`,
    );
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.total).toBe(manifest.counts[type]);
    expect(result.items).toHaveLength(20);
    await page.goto(`/?view=items&project=${project.id}&type=${type}`);
    await expect(page.locator(".ant-table-tbody .ant-table-row")).toHaveCount(
      20,
    );
    const letter = (
      { requirement: "R", task: "T", bug: "B" } as Record<string, string>
    )[type];
    const picture = await (
      await page.request.get(
        `/api/v1/projects/${project.id}/work-items?q=${project.code}-${letter}-1&type=${type}&sort=number`,
      )
    ).json();
    const item = picture.items.find((row: any) => row.number.endsWith("-1"));
    expect(item).toBeTruthy();
    await page.goto(
      `/?view=items&project=${project.id}&type=${type}&item_mode=detail&item_id=${item.id}&item_type=${type}`,
    );
    await expect(
      page.getByRole("heading", { name: item.title, exact: true }),
    ).toBeVisible();
    const image = page
      .locator('.work-page img[src*="/api/v1/attachments/"]')
      .first();
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBeTruthy();
    const files = await (
      await page.request.get(`/api/v1/work-items/${item.id}/attachments`)
    ).json();
    expect(files.total).toBeGreaterThanOrEqual(3);
    for (const file of files.items)
      expect(
        (await page.request.get(`/api/v1/attachments/${file.id}`)).ok(),
      ).toBeTruthy();
  }
  const linkedBug = (
    await (
      await page.request.get(
        `/api/v1/projects/${project.id}/work-items?type=bug&q=${project.code}-B-320`,
      )
    ).json()
  ).items[0];
  const linkedTask = await (
    await page.request.get(`/api/v1/work-items/${linkedBug.details.task}`)
  ).json();
  await page.goto(
    `/?view=items&project=${project.id}&type=bug&item_mode=detail&item_id=${linkedBug.id}&item_type=bug`,
  );
  await expect(page.locator(".item-detail-right")).toContainText(
    linkedTask.title,
  );
  await page.goto(
    `/?view=items&project=${project.id}&type=task&item_mode=create&item_type=task`,
  );
  const related = page.getByRole("combobox", { name: "关联需求", exact: true });
  await related.fill(`${project.code}-R-110`);
  const option = page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: `${project.code}-R-110` });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(
    page.locator(".ant-form-item").filter({ has: related }),
  ).toContainText("场景完善");
  const visibleProjects = await (
    await page.request.get("/api/v1/projects?page_size=100")
  ).json();
  const denied = manifest.projects.find(
    (row: any) =>
      !visibleProjects.items.some((visible: any) => visible.id === row.id),
  );
  if (denied)
    expect(
      (
        await page.request.get(`/api/v1/projects/${denied.id}/work-items`)
      ).status(),
    ).toBe(404);
  const docs = await (
    await page.request.get(`/api/v1/projects/${project.id}/documents`)
  ).json();
  const document = docs.items.find((row: any) => row.document_type === "docx");
  expect(document).toBeTruthy();
  await page.goto(
    `/?view=documents&project=${project.id}&item_mode=detail&item_id=${document.id}&item_type=document`,
  );
  await expect(page.locator(".document-titlebar")).toContainText(
    document.title,
  );
  await expect(page.locator(".unified-file-preview")).toHaveAttribute(
    "data-preview-ready",
    "true",
    { timeout: 30000 },
  );
  if (document.document_type === "docx")
    await expect(page.locator(".docx-wrapper")).toContainText("模拟");
});
