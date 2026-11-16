import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Server-side image handling for user uploads. Everything is re-encoded, which strips EXIF
 * metadata (including GPS location) and flattens animated images to their first frame.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies over 4.5 MB
const MAX_INPUT_PIXELS = 50_000_000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageError";
  }
}

/** A crop rectangle in pixels of the (EXIF-oriented) original image, from the browser cropper. */
export type CropRect = { x: number; y: number; width: number; height: number };

export type ProcessedImage = { bytes: Buffer; contentType: "image/webp"; hash: string };

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** Validates the file by *content* (not the client's claimed type) and applies EXIF rotation. */
async function open(input: Buffer): Promise<{ oriented: Buffer; width: number; height: number }> {
  if (input.byteLength === 0) throw new ImageError("The file is empty.");
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new ImageError("Image must be under 4 MB.");
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
      throw new ImageError("Use a JPEG, PNG or WebP image.");
    }
    // Apply the EXIF orientation first so crop coordinates (from the browser, which displays
    // the image oriented) line up with the pixels we crop.
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    return { oriented: data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError("That doesn't look like a valid image.");
  }
}

/** Clamp a client-supplied crop to the image; fall back to a centered crop of `aspect`. */
export function resolveCrop(
  size: { width: number; height: number },
  aspect: number,
  crop?: CropRect,
): CropRect {
  const valid =
    crop &&
    [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) &&
    crop.width >= 1 &&
    crop.height >= 1;
  if (valid) {
    const x = Math.max(0, Math.min(Math.round(crop.x), size.width - 1));
    const y = Math.max(0, Math.min(Math.round(crop.y), size.height - 1));
    const width = Math.max(1, Math.min(Math.round(crop.width), size.width - x));
    const height = Math.max(1, Math.min(Math.round(crop.height), size.height - y));
    return { x, y, width, height };
  }
  // Largest centered rectangle with the wanted aspect ratio.
  let width = size.width;
  let height = Math.round(width / aspect);
  if (height > size.height) {
    height = size.height;
    width = Math.round(height * aspect);
  }
  return {
    x: Math.floor((size.width - width) / 2),
    y: Math.floor((size.height - height) / 2),
    width,
    height,
  };
}

async function cropAndResize(
  oriented: Buffer,
  region: CropRect,
  width: number,
  height: number,
): Promise<ProcessedImage> {
  const bytes = await sharp(oriented)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .resize(width, height, { fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes, contentType: "image/webp", hash: digest(bytes) };
}

/** 400x400 square. */
export async function processAvatar(input: Buffer, crop?: CropRect): Promise<ProcessedImage> {
  const { oriented, width, height } = await open(input);
  return cropAndResize(oriented, resolveCrop({ width, height }, 1, crop), 400, 400);
}

/**
 * Banners are stored 2:1 and shown whole on phones; on wide screens they are displayed 3:1 and
 * the browser crops them vertically around the user-chosen focal point (profiles.bannerFocalY).
 */
export const BANNER_ASPECT = 2;

/** 1500x750 and 750x375 (2:1). */
export async function processBanner(
  input: Buffer,
  crop?: CropRect,
): Promise<{ full: ProcessedImage; small: ProcessedImage }> {
  const { oriented, width, height } = await open(input);
  const region = resolveCrop({ width, height }, BANNER_ASPECT, crop);
  const [full, small] = await Promise.all([
    cropAndResize(oriented, region, 1500, 750),
    cropAndResize(oriented, region, 750, 375),
  ]);
  return { full, small };
}

export const avatarKey = (userId: string, hash: string) => `avatars/${userId}/${hash}.webp`;
export const bannerKey = (userId: string, hash: string) => `banners/${userId}/${hash}.webp`;
/** The 750px version of a banner lives next to the full one. */
export const bannerSmallKey = (key: string) => key.replace(/\.webp$/, "-sm.webp");
