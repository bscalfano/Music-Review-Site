import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** Cloudflare R2 via its S3-compatible API. All settings come from env (see .env.example). */
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
    publicUrl: (key) => `${config.publicUrl}/${key}`,
  };
}

/** The configured storage, or null when R2 isn't set up (local dev before Phase 1 setup). */
export function getStorage(): Storage | null {
  const config = readStorageConfig();
  return config ? createR2Storage(config) : null;
}
