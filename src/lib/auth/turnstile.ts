import type { FetchLike } from "@/lib/music/http";

/** Cloudflare Turnstile: invisible bot check on the sign-in / sign-up form. */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}

export type TurnstileDeps = {
  secret?: string;
  fetchImpl?: FetchLike;
  production?: boolean;
};

/**
 * Verifies a token from the widget. Fails *closed* in production when no secret is configured,
 * so a missing env var can never silently disable bot protection there. In development with no
 * secret the check is skipped so local work doesn't need Cloudflare keys.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip?: string | null,
  deps: TurnstileDeps = {},
): Promise<boolean> {
  const {
    secret = process.env.TURNSTILE_SECRET_KEY,
    fetchImpl = fetch as FetchLike,
    production = process.env.NODE_ENV === "production",
  } = deps;

  if (!secret) return !production;
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
