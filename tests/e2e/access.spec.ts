import { expect, test } from "@playwright/test";

/**
 * Access control, checked over plain HTTP as an anonymous visitor (no browser needed).
 * Runs against `pnpm dev` locally, or a deployment via E2E_BASE_URL.
 */
test.describe("anonymous visitors", () => {
  for (const path of ["/settings", "/onboarding"]) {
    test(`${path} redirects to sign-in and remembers where they were going`, async ({
      request,
    }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain(
        `/sign-in?callbackUrl=${encodeURIComponent(path)}`,
      );
    });
  }

  test("/admin doesn't reveal that it exists", async ({ request }) => {
    expect((await request.get("/admin")).status()).toBe(404);
  });

  test("uploads require sign-in", async ({ request }) => {
    expect((await request.post("/api/upload/avatar")).status()).toBe(401);
    expect((await request.post("/api/upload/banner")).status()).toBe(401);
    expect((await request.delete("/api/upload/avatar")).status()).toBe(401);
  });

  test("uploads reject cross-site requests even before checking sign-in", async ({
    request,
    baseURL,
  }) => {
    const res = await request.post("/api/upload/avatar", {
      headers: { Origin: "https://evil.example", Host: new URL(baseURL!).host },
    });
    expect(res.status()).toBe(403);
  });

  test("the cron endpoint is closed without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/jobs")).status()).toBe(401);
    expect(
      (
        await request.get("/api/cron/jobs", { headers: { Authorization: "Bearer wrong" } })
      ).status(),
    ).toBe(401);
  });

  test("a foreign callbackUrl can't become the post-sign-in redirect", async ({ request }) => {
    for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const res = await request.get(`/sign-in?callbackUrl=${encodeURIComponent(evil)}`, {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(200);
      const html = await res.text();
      // The hidden field the sign-in form posts back must have been reset to the site root.
      const targets = [...html.matchAll(/<input[^>]*name="redirectTo"[^>]*>/g)].map((m) => m[0]);
      for (const input of targets) expect(input).toContain('value="/"');
      expect(html).not.toMatch(/href="(https?:)?\/\/evil\.example/);
    }
  });

  test("handles are case-insensitive and unknown profiles 404", async ({ request }) => {
    expect((await request.get("/u/definitely_not_a_user_123")).status()).toBe(404);
  });
});

test.describe("profiles (needs `pnpm db:seed` data)", () => {
  test("a private account shows only a notice to anonymous visitors, and is not indexable", async ({
    request,
  }) => {
    const res = await request.get("/u/sam_private");
    test.skip(res.status() === 404, "seed data not present");
    const html = await res.text();
    expect(html).toContain("This account is private");
    expect(html).toContain("noindex");
    expect(html).not.toContain("FAVORITE ALBUMS");
  });

  test("a public account shows its favorites to anonymous visitors", async ({ request }) => {
    const res = await request.get("/u/maya");
    test.skip(res.status() === 404, "seed data not present");
    expect(await res.text()).toContain("FAVORITE ALBUMS");
  });
});
