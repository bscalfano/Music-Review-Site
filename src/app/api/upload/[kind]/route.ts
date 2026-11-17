import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import {
  avatarKey,
  bannerKey,
  bannerSmallKey,
  ImageError,
  MAX_UPLOAD_BYTES,
  processAvatar,
  processBanner,
  processInlineImage,
  reviewImageKey,
} from "@/lib/images/process";
import { avatarUrl, bannerUrl } from "@/lib/profiles/queries";
import { getStorage } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

const { users, profiles } = schema;

const cropSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Ctx = { params: Promise<{ kind: string }> };

/** Same-origin only. (Route handlers don't get the built-in CSRF check that server actions do.) */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === req.headers.get("host");
}

async function authorize(req: Request, ctx: Ctx) {
  const { kind } = await ctx.params;
  if (kind !== "avatar" && kind !== "banner" && kind !== "review-image")
    return { error: json({ error: "Not found" }, 404) } as const;
  if (!sameOrigin(req)) return { error: json({ error: "Forbidden" }, 403) } as const;
  const user = await getCurrentUser();
  if (!user?.handle) return { error: json({ error: "Please sign in." }, 401) } as const;
  return { kind, user } as const;
}

/** Upload (or replace) an avatar or banner: multipart `file`, optional `crop` JSON, `focalY`. */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await authorize(req, ctx);
  if ("error" in auth) return auth.error;
  const { kind, user } = auth;

  const storage = getStorage();
  if (!storage) return json({ error: "File storage isn't configured yet." }, 503);

  // Reject oversized bodies before buffering them (multipart adds a little overhead).
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json({ error: "Image must be under 4 MB." }, 413);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "No file was uploaded." }, 400);

  let crop: z.infer<typeof cropSchema> | undefined;
  const rawCrop = form?.get("crop");
  if (typeof rawCrop === "string" && rawCrop) {
    try {
      crop = cropSchema.parse(JSON.parse(rawCrop));
    } catch {
      return json({ error: "Invalid crop." }, 400);
    }
  }

  const db = getDb();
  try {
    const input = Buffer.from(await file.arrayBuffer());

    if (kind === "review-image") {
      const img = await processInlineImage(input);
      const key = reviewImageKey(user.id, img.hash);
      await storage.put({ key, body: img.bytes, contentType: img.contentType });
      return json({ url: storage.publicUrl(key) });
    }

    if (kind === "avatar") {
      const img = await processAvatar(input, crop);
      const key = avatarKey(user.id, img.hash);
      await storage.put({ key, body: img.bytes, contentType: img.contentType });
      await db.update(users).set({ image: key }).where(eq(users.id, user.id));
      // Replace, don't accumulate: delete the previous upload (never a Google picture URL).
      if (user.image && user.image !== key && !/^https?:\/\//.test(user.image))
        await storage.delete(user.image);
      revalidatePath(`/u/${user.handle}`);
      return json({ url: avatarUrl(key) });
    }

    const { full, small } = await processBanner(input, crop);
    const key = bannerKey(user.id, full.hash);
    await storage.put({ key, body: full.bytes, contentType: full.contentType });
    await storage.put({
      key: bannerSmallKey(key),
      body: small.bytes,
      contentType: small.contentType,
    });
    const [existing] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    const focal = z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .safeParse(form?.get("focalY") ?? 50);
    const bannerFocalY = focal.success ? focal.data : 50;
    await db
      .insert(profiles)
      .values({ userId: user.id, bannerKey: key, bannerFocalY })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { bannerKey: key, bannerFocalY, updatedAt: new Date() },
      });
    if (existing?.bannerKey && existing.bannerKey !== key) {
      await storage.delete(existing.bannerKey);
      await storage.delete(bannerSmallKey(existing.bannerKey));
    }
    revalidatePath(`/u/${user.handle}`);
    return json({ url: bannerUrl(key) });
  } catch (err) {
    if (err instanceof ImageError) return json({ error: err.message }, 400);
    console.error("[upload] failed", err);
    return json({ error: "Upload failed. Please try again." }, 500);
  }
}

/** Remove the custom avatar or banner. */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authorize(req, ctx);
  if ("error" in auth) return auth.error;
  const { kind, user } = auth;
  if (kind === "review-image") return json({ error: "Not found" }, 404);
  const storage = getStorage();
  const db = getDb();

  if (kind === "avatar") {
    await db.update(users).set({ image: null }).where(eq(users.id, user.id));
    if (storage && user.image && !/^https?:\/\//.test(user.image)) await storage.delete(user.image);
  } else {
    const [existing] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    await db.update(profiles).set({ bannerKey: null }).where(eq(profiles.userId, user.id));
    if (storage && existing?.bannerKey) {
      await storage.delete(existing.bannerKey);
      await storage.delete(bannerSmallKey(existing.bannerKey));
    }
  }
  revalidatePath(`/u/${user.handle}`);
  return json({ ok: true });
}
