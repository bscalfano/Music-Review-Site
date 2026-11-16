import { like } from "drizzle-orm";
import type { Metadata } from "next";
import Script from "next/script";
import { redirect } from "next/navigation";
import { DEV_LOGIN_ENABLED, providerAvailability, SEED_EMAIL_LIKE } from "@/auth";
import { getDb, schema } from "@/db";
import { siteConfig } from "@/config/site";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { getCurrentUser, safeRedirectPath } from "@/lib/auth/session";
import { turnstileSiteKey } from "@/lib/auth/turnstile";
import { signInAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  captcha: "We couldn't verify you're human. Please try again.",
  email: "Please enter a valid email address.",
  unavailable: "That sign-in method isn't available.",
  AccessDenied: "This account can't sign in.",
  OAuthAccountNotLinked: "That email is already registered with a different sign-in method.",
  Verification: "That sign-in link has expired or was already used. Request a new one.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = safeRedirectPath(callbackUrl);
  if (await getCurrentUser()) redirect(redirectTo);

  const siteKey = turnstileSiteKey();
  const anyRealProvider = providerAvailability.google || providerAvailability.email;
  const seedUsers = DEV_LOGIN_ENABLED
    ? await getDb()
        .select({ handle: schema.users.handle, email: schema.users.email })
        .from(schema.users)
        .where(like(schema.users.email, SEED_EMAIL_LIKE))
    : [];

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Sign in to {siteConfig.name}</h1>
        <p className="text-muted-foreground text-sm">New here? Signing in creates your account.</p>
      </div>

      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
          {ERRORS[error] ?? "Something went wrong. Please try again."}
        </p>
      )}

      {anyRealProvider ? (
        <form action={signInAction} className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          {providerAvailability.google && (
            <Button
              type="submit"
              name="provider"
              value="google"
              variant="outline"
              size="lg"
              className="w-full"
              formNoValidate
            >
              Continue with Google
            </Button>
          )}
          {providerAvailability.google && providerAvailability.email && (
            <p className="text-muted-foreground text-center text-xs">or</p>
          )}
          {providerAvailability.email && (
            <div className="space-y-2">
              <Label htmlFor="email">Email me a sign-in link</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
              />
              <Button type="submit" name="provider" value="email" size="lg" className="w-full">
                Send link
              </Button>
            </div>
          )}
          {siteKey && (
            <>
              <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" />
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                strategy="afterInteractive"
              />
            </>
          )}
        </form>
      ) : (
        !DEV_LOGIN_ENABLED && (
          <p className="text-muted-foreground text-sm">
            Sign-in isn&apos;t configured yet. Set Google and/or Resend credentials (see
            .env.example).
          </p>
        )
      )}

      {DEV_LOGIN_ENABLED && (
        <section
          className="space-y-3 rounded-lg border border-dashed p-4"
          aria-label="Development sign-in"
        >
          <h2 className="text-sm font-semibold">Dev sign-in (local only)</h2>
          <p className="text-muted-foreground text-xs">
            Sign in as a seed user. This is only available while running <code>pnpm dev</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            {seedUsers.map((u) => (
              <form key={u.email} action={signInAction}>
                <input type="hidden" name="provider" value="dev" />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="identifier" value={u.handle ?? u.email} />
                <Button type="submit" variant="secondary" size="sm">
                  {u.handle ? `@${u.handle}` : "(new user)"}
                </Button>
              </form>
            ))}
            {seedUsers.length === 0 && (
              <p className="text-muted-foreground text-xs">
                No seed users. Run <code>pnpm db:seed</code>.
              </p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
