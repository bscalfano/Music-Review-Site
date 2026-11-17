import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * File storage for covers, avatars and banners.
 *  - Production: Cloudflare R2 via its S3-compatible API (settings from env, see .env.example).
 *  - Development without R2 keys: a local folder, public/uploads (git-ignored).
 *  - Otherwise: null, and callers degrade gracefully (e.g. covers fall back to Cover Art Archive).
 */
export type StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
};

export function readStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = env;
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET ||
    !R2_PUBLIC_URL
  ) {
    return null;
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    publicUrl: R2_PUBLIC_URL.replace(/\/+$/, ""),
  };
}

export interface Storage {
  put(args: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  /** Best effort: a failed delete must never fail the request that triggered it. */
  delete(key: string): Promise<void>;
  /** Deletes every object whose key starts with `prefix` (e.g. all of one user's uploads). */
  deletePrefix(prefix: string): Promise<void>;
  publicUrl(key: string): string;
}

export function createR2Storage(config: StorageConfig): Storage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    async put({ key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are content-addressed or versioned, so they can be cached forever.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (err) {
        console.error("[storage] delete failed", key, err);
      }
    },
    async deletePrefix(prefix) {
      try {
        let token: string | undefined;
        do {
          const page = await client.send(
            new ListObjectsV2Command({
              Bucket: config.bucket,
              Prefix: prefix,
              ContinuationToken: token,
            }),
          );
          const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
          if (keys.length > 0) {
            await client.send(
              new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: keys } }),
            );
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
      } catch (err) {
        console.error("[storage] deletePrefix failed", prefix, err);
      }
    },
    publicUrl: (key) => `${config.publicUrl}/${key}`,
  };
}

const LOCAL_DIR = resolve(process.cwd(), "public", "uploads");

export function createLocalStorage(dir = LOCAL_DIR): Storage {
  const pathFor = (key: string) => {
    const full = resolve(dir, key);
    if (!full.startsWith(dir + sep)) throw new Error(`Invalid storage key: ${key}`); // no ../ escapes
    return full;
  };
  return {
    async put({ key, body }) {
      const file = pathFor(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async delete(key) {
      await rm(pathFor(key), { force: true }).catch(() => {});
    },
    async deletePrefix(prefix) {
      await rm(pathFor(prefix.replace(/\/+$/, "")), { recursive: true, force: true }).catch(
        () => {},
      );
    },
    publicUrl: (key) => `/uploads/${key}`,
  };
}

/** The storage to use right now, or null when nothing is configured. */
export function getStorage(): Storage | null {
  const config = readStorageConfig();
  if (config) return createR2Storage(config);
  if (process.env.NODE_ENV === "development") return createLocalStorage();
  return null;
}

/** Public URL for a stored object's key, or null when no storage is available. */
export function storagePublicUrl(key: string): string | null {
  return getStorage()?.publicUrl(key) ?? null;
}
