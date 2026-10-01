import { expect, test } from "@playwright/test";

const firstURL = process.env.TV_DYNAMIC_FIRST_URL;
const secondURL = process.env.TV_DYNAMIC_SECOND_URL;
if (!firstURL) throw new Error("TV_DYNAMIC_FIRST_URL is required");
if (!secondURL) throw new Error("TV_DYNAMIC_SECOND_URL is required");

test("receives two independent service URLs and later config sees the earlier URL", async ({ page, request, baseURL }) => {
  expect(baseURL).toBe(secondURL);
  expect(new URL(firstURL).port).not.toBe(new URL(secondURL).port);

  const firstResponse = await request.get(firstURL);
  expect(firstResponse.ok()).toBe(true);
  expect(await firstResponse.text()).toContain("first dynamic service");

  const publicationResponse = await request.get(new URL("/__first_url", secondURL).href);
  expect(publicationResponse.ok()).toBe(true);
  expect(await publicationResponse.text()).toBe(firstURL);

  await page.goto("/");
  await expect(page.locator("body")).toContainText("second dynamic service");
});
