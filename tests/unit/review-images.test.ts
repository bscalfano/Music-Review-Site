import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageError,
  processInlineImage,
  REVIEW_IMAGE_PREFIX,
  reviewImageKey,
} from "@/lib/images/process";

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .withExif({ IFD0: { Copyright: "secret" } })
    .png()
    .toBuffer();

describe("inline review images", () => {
  it("shrinks large images to fit 1600px and re-encodes as webp", async () => {
    const out = await processInlineImage(await png(3200, 1600));
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(800);
  });

  it("never enlarges small images", async () => {
    const out = await processInlineImage(await png(300, 200));
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("strips metadata", async () => {
    const out = await processInlineImage(await png(200, 200));
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
  });

  it("rejects things that aren't images, whatever they claim to be", async () => {
    await expect(
      processInlineImage(Buffer.from("<svg onload=alert(1)></svg>")),
    ).rejects.toBeInstanceOf(ImageError);
    await expect(processInlineImage(Buffer.from("not an image"))).rejects.toBeInstanceOf(
      ImageError,
    );
    await expect(processInlineImage(Buffer.alloc(0))).rejects.toBeInstanceOf(ImageError);
  });

  it("stores under the review-images prefix, per user", () => {
    expect(reviewImageKey("u1", "abc")).toBe(`${REVIEW_IMAGE_PREFIX}u1/abc.webp`);
  });
});
