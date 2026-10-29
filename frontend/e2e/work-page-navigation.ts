import { expect, type Locator, type Page } from "@playwright/test";
// Follow a real popup, then continue the existing business-flow fixture on its URL.
export async function followWorkPage(page: Page, link: Locator) {
  await expect(link).toBeVisible();
  const normalized = (value: string) => {
    const url = new URL(value);
    url.searchParams.set("page", url.searchParams.get("page") || "1");
    url.searchParams.set("q", url.searchParams.get("q") || "");
    url.searchParams.set(
      "page_size",
      url.searchParams.get("page_size") || "20",
    );
    url.searchParams.sort();
    return url.href;
  };
  const original = normalized(page.url());
  const [child] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await child.waitForLoadState("domcontentloaded");
  expect(normalized(page.url())).toBe(original);
  const target = child.url();
  expect(
    new URL(target).searchParams.get("item_mode") ||
      (new URL(target).pathname.startsWith("/p/") ? "detail" : ""),
  ).toMatch(/create|detail/);
  await page.goto(target);
  await child.close();
}
