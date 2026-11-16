import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import {
  avatarKey,
  bannerSmallKey,
  ImageError,
  MAX_UPLOAD_BYTES,
  processAvatar,
  processBanner,
  resolveCrop,
} from "@/lib/images/process";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import type { FetchLike } from "@/lib/music/http";
import { createLocalStorage } from "@/lib/storage/r2";
import { fakeFetch, json } from "../helpers";

/** A solid-colour test image, optionally with EXIF orientation and GPS-ish metadata. */
const makeImage = (
  w: number,
  h: number,
  format: "jpeg" | "png" | "webp" = "png",
  opts: { orientation?: number } = {},
) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: "#cc3366" } });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img[format]().toBuffer();
};

describe("avatar processing", () => {
  it("produces a 400x400 webp", async () => {
    const out = await processAvatar(await makeImage(1000, 600, "jpeg"));
    const meta = await sharp(out.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 400, 400]);
    expect(out.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("strips EXIF metadata", async () => {
    const withExif = await sharp(await makeImage(300, 300, "jpeg"))
      .withExif({ IFD0: { Copyright: "secret", Artist: "someone" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processAvatar(withExif);
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
  });

  it("flattens an animated image to one frame", async () => {
    const frame = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#fff" },
    })
      .raw()
      .toBuffer();
    const animated = await sharp(Buffer.concat([frame, frame]), {
      raw: { width: 40, height: 40, channels: 3, pageHeight: 40 },
    })
      .webp({ loop: 0 })
      .toBuffer();
    const out = await processAvatar(animated);
    expect((await sharp(out.bytes).metadata()).pages ?? 1).toBe(1);
  });

  it("is deterministic: the same upload gives the same hash (content-addressed keys)", async () => {
    const input = await makeImage(500, 500);
    expect((await processAvatar(input)).hash).toBe((await processAvatar(input)).hash);
  });

  it("rejects files that aren't allowed images, by content rather than by name", async () => {
    await expect(
      processAvatar(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).rejects.toThrow(ImageError);
    await expect(processAvatar(Buffer.from("not an image at all"))).rejects.toThrow(ImageError);
    await expect(
      processAvatar(
        await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
          .gif()
          .toBuffer(),
      ),
    ).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(processAvatar(Buffer.alloc(0))).rejects.toThrow(/empty/);
  });

  it("rejects uploads over the size limit", async () => {
    await expect(processAvatar(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(/under 4 MB/);
  });

  it("honours EXIF orientation before cropping, so browser crop coordinates line up", async () => {
    // 200x100 stored image tagged "rotate 90°" displays as 100x200: crop the TOP 100x100 square.
    const input = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#0000ff" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 100, channels: 3, background: "#ff0000" },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 0,
        },
      ])
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toBuffer();
    // Orientation 6 = rotate 90° clockwise: the right half (red) becomes the bottom half.
    const bottom = await processAvatar(input, { x: 0, y: 100, width: 100, height: 100 });
    const { dominant } = await sharp(bottom.bytes).stats();
    expect(dominant.r).toBeGreaterThan(200);
    expect(dominant.b).toBeLessThan(80);
  });
});

describe("crop resolution", () => {
  const size = { width: 1000, height: 600 };

  it("clamps a crop that overshoots the image", () => {
    expect(resolveCrop(size, 1, { x: 900, y: 500, width: 500, height: 500 })).toEqual({
      x: 900,
      y: 500,
      width: 100,
      height: 100,
    });
    expect(resolveCrop(size, 1, { x: -50, y: -50, width: 100, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("falls back to a centered crop of the right aspect for missing or junk input", () => {
    expect(resolveCrop(size, 1)).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    expect(resolveCrop(size, 2)).toEqual({ x: 0, y: 50, width: 1000, height: 500 });
    expect(resolveCrop(size, 1, { x: NaN, y: 0, width: 10, height: 10 })).toEqual({
      x: 200,
      y: 0,
      width: 600,
      height: 600,
    });
    expect(resolveCrop(size, 1, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 200,
      y: 0,
      width: 600,
      height: 600,
    });
  });
});

describe("banner processing", () => {
  it("produces 1500x750 and 750x375 (2:1) versions", async () => {
    const { full, small } = await processBanner(await makeImage(3000, 2000, "jpeg"));
    expect(await sharp(full.bytes).metadata()).toMatchObject({
      width: 1500,
      height: 750,
      format: "webp",
    });
    expect(await sharp(small.bytes).metadata()).toMatchObject({ width: 750, height: 375 });
  });

  it("derives the small key from the full key", () => {
    expect(bannerSmallKey("banners/u1/abc123.webp")).toBe("banners/u1/abc123-sm.webp");
    expect(avatarKey("u1", "abc")).toBe("avatars/u1/abc.webp");
  });
});

describe("local storage", () => {
  const dirs: string[] = [];
  const fresh = async () => {
    const dir = await mkdtemp(join(tmpdir(), "storage-test-"));
    dirs.push(dir);
    return { dir, storage: createLocalStorage(dir) };
  };
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("stores, serves a URL for, and deletes objects", async () => {
    const { dir, storage } = await fresh();
    await storage.put({
      key: "avatars/u1/x.webp",
      body: Buffer.from("hi"),
      contentType: "image/webp",
    });
    expect((await readFile(join(dir, "avatars", "u1", "x.webp"))).toString()).toBe("hi");
    expect(storage.publicUrl("avatars/u1/x.webp")).toBe("/uploads/avatars/u1/x.webp");
    await storage.delete("avatars/u1/x.webp");
    await expect(stat(join(dir, "avatars", "u1", "x.webp"))).rejects.toThrow();
    await expect(storage.delete("does/not/exist.webp")).resolves.toBeUndefined();
  });

  it("refuses keys that escape the storage folder", async () => {
    const { storage } = await fresh();
    await expect(
      storage.put({ key: "../evil.txt", body: Buffer.from("x"), contentType: "text/plain" }),
    ).rejects.toThrow(/Invalid storage key/);
  });
});

describe("Turnstile", () => {
  const ok = fakeFetch([["siteverify", () => json({ success: true })]]);
  const bad = fakeFetch([
    ["siteverify", () => json({ success: false, "error-codes": ["invalid-input-response"] })],
  ]);

  it("accepts a token Cloudflare approves, and sends the secret, token and IP", async () => {
    expect(await verifyTurnstile("tok", "1.2.3.4", { secret: "s", fetchImpl: ok.fetch })).toBe(
      true,
    );
    const body = new URLSearchParams(String(ok.calls[0].init?.body));
    expect(Object.fromEntries(body)).toEqual({ secret: "s", response: "tok", remoteip: "1.2.3.4" });
  });

  it("rejects bad, missing, or unverifiable tokens", async () => {
    expect(await verifyTurnstile("tok", null, { secret: "s", fetchImpl: bad.fetch })).toBe(false);
    expect(await verifyTurnstile(null, null, { secret: "s", fetchImpl: ok.fetch })).toBe(false);
    const down = fakeFetch([["siteverify", () => json({}, 500)]]);
    expect(await verifyTurnstile("tok", null, { secret: "s", fetchImpl: down.fetch })).toBe(false);
    const throws = (async () => {
      throw new Error("network");
    }) as unknown as FetchLike;
    expect(await verifyTurnstile("tok", null, { secret: "s", fetchImpl: throws })).toBe(false);
  });

  it("fails CLOSED in production without a secret, but is skipped in development", async () => {
    expect(await verifyTurnstile("tok", null, { secret: "", production: true })).toBe(false);
    expect(await verifyTurnstile(undefined, null, { secret: "", production: true })).toBe(false);
    expect(await verifyTurnstile(undefined, null, { secret: "", production: false })).toBe(true);
  });
});
