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

test.describe("reviews and album pages (need `pnpm db:seed` data)", () => {
  const RUMOURS = "/albums/rumours-416bb5e5-c7d1-3977-8fd7-7c9daf6c2be6";

  test("writing requires sign-in", async ({ request }) => {
    for (const path of ["/write", "/write/00000000-0000-4000-8000-000000000000"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers()["location"]).toContain("/sign-in");
    }
    expect((await request.post("/api/upload/review-image")).status()).toBe(401);
  });

  test("a public review is readable by anyone and gets a share image", async ({ request }) => {
    const res = await request.get("/u/maya/discovery");
    test.skip(res.status() === 404, "seed data not present");
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain("noindex");

    const image = await request.get("/u/maya/discovery/opengraph-image");
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  });

  test("a private account's review looks like it doesn't exist to strangers", async ({
    request,
  }) => {
    const probe = await request.get("/u/maya/discovery");
    test.skip(probe.status() === 404, "seed data not present");
    expect((await request.get("/u/sam_private/rumours")).status()).toBe(404);
    // The share image must not reveal anything either: it falls back to the generic site image.
    const image = await request.get("/u/sam_private/rumours/opengraph-image");
    expect(image.status()).toBe(200);
  });

  test("drafts are invisible to everyone but their author", async ({ request }) => {
    const probe = await request.get("/u/maya/discovery");
    test.skip(probe.status() === 404, "seed data not present");
    expect((await request.get("/u/maya/kid-a")).status()).toBe(404);
  });

  test("an album page lists public reviewers but never private ones", async ({ request }) => {
    const res = await request.get(RUMOURS);
    test.skip(res.status() === 404, "seed data not present");
    const html = await res.text();
    expect(html).toContain("Ratings");
    expect(html).toContain("/u/maya");
    expect(html).not.toContain("sam_private");

    const all = await request.get(`${RUMOURS}/reviews?sort=popular`);
    expect(all.status()).toBe(200);
    expect(await all.text()).not.toContain("sam_private");
  });

  test("album URLs: a wrong slug redirects, junk 404s", async ({ request }) => {
    const probe = await request.get(RUMOURS);
    test.skip(probe.status() === 404, "seed data not present");
    const wrong = await request.get("/albums/wrong-slug-416bb5e5-c7d1-3977-8fd7-7c9daf6c2be6", {
      maxRedirects: 0,
    });
    expect(wrong.status()).toBe(308);
    expect(wrong.headers()["location"]).toContain(RUMOURS);
    expect((await request.get("/albums/not-an-album")).status()).toBe(404);
    expect((await request.get("/albums/ghost-00000000-0000-4000-8000-000000000000")).status()).toBe(
      404,
    );
  });
});

test.describe("social pages", () => {
  test("the feed and notifications need sign-in", async ({ request }) => {
    for (const path of ["/feed", "/notifications"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers()["location"]).toContain(
        `/sign-in?callbackUrl=${encodeURIComponent(path)}`,
      );
    }
  });

  test("home sends signed-out visitors to Discover, which is public", async ({ request }) => {
    const home = await request.get("/", { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers()["location"]).toBe("/discover");
    const discover = await request.get("/discover");
    expect(discover.status()).toBe(200);
    expect(await discover.text()).toContain("Sign in");
  });

  test("a private account's follower lists are hidden from strangers (needs seed data)", async ({
    request,
  }) => {
    const probe = await request.get("/u/maya");
    test.skip(probe.status() === 404, "seed data not present");
    const priv = await request.get("/u/sam_private/followers");
    expect(priv.status()).toBe(200);
    const html = await priv.text();
    expect(html).toContain("This account is private");
    expect(html).toContain("noindex");
    expect((await request.get("/u/maya/followers")).status()).toBe(200);
    expect((await request.get("/u/nobody_here_123/following")).status()).toBe(404);
  });

  test("private accounts never appear on Discover (needs seed data)", async ({ request }) => {
    const probe = await request.get("/u/maya");
    test.skip(probe.status() === 404, "seed data not present");
    const html = await (await request.get("/discover")).text();
    expect(html).not.toContain("sam_private");
  });
});

test.describe("safety, legal and SEO pages", () => {
  for (const path of ["/terms", "/privacy", "/guidelines", "/about"]) {
    test(`${path} is public`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(await res.text()).toContain("<h1");
    });
  }

  test("admin pages and the data export don't exist for anonymous visitors", async ({
    request,
  }) => {
    for (const path of ["/admin", "/admin/users", "/admin/activity", "/admin/import"]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
    expect((await request.get("/api/account/export")).status()).toBe(401);
  });

  test("the health check reaches the database", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("robots.txt hides private areas and links the sitemap", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    expect(text).toContain("Disallow: /admin");
    expect(text).toContain("Disallow: /settings");
    expect(text).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("security headers are set", async ({ request }) => {
    const headers = (await request.get("/about")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBeTruthy();
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("the sitemap and RSS never include private accounts (needs seed data)", async ({
    request,
  }) => {
    const probe = await request.get("/u/maya");
    test.skip(probe.status() === 404, "seed data not present");

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/u/maya");
    expect(sitemap).not.toContain("sam_private");

    const site = await request.get("/rss.xml");
    expect(site.headers()["content-type"]).toContain("application/rss+xml");
    expect(await site.text()).not.toContain("sam_private");

    const maya = await request.get("/u/maya/rss.xml");
    expect(maya.status()).toBe(200);
    expect(await maya.text()).toContain("<item>");
    expect((await request.get("/u/sam_private/rss.xml")).status()).toBe(404);
  });

  test("a private profile has no RSS link and stays noindex (needs seed data)", async ({
    request,
  }) => {
    const probe = await request.get("/u/maya");
    test.skip(probe.status() === 404, "seed data not present");
    expect(await (await request.get("/u/maya")).text()).toContain("/u/maya/rss.xml");
    expect(await (await request.get("/u/sam_private")).text()).not.toContain(
      "/u/sam_private/rss.xml",
    );
  });
});
