import { expect, test } from "@playwright/test";

test("home page loads and shows the site name", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("<h1");
});
