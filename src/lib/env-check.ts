/**
 * Pre-deploy configuration check (`pnpm check:env`). Pure: takes an env object so it can be
 * tested. "Required" problems would break production or leave it unsafe; "recommended" ones
 * leave a feature off or degraded.
 */
export type EnvIssue = { level: "required" | "recommended"; name: string; message: string };

const present = (v: string | undefined) => !!v && v.trim() !== "";

export function checkProductionEnv(env: Record<string, string | undefined>): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const need = (name: string, message: string) => {
    if (!present(env[name])) issues.push({ level: "required", name, message });
  };
  const want = (name: string, message: string) => {
    if (!present(env[name])) issues.push({ level: "recommended", name, message });
  };

  need("DATABASE_URL", "Neon pooled connection string.");
  need("AUTH_SECRET", "Random secret for sessions (npx auth secret).");
  need("CRON_SECRET", "Protects /api/cron/jobs; without it the cron endpoint refuses to run.");
  need("OWNER_EMAIL", "The email that becomes the owner (admin) account.");
  need("TURNSTILE_SECRET_KEY", "Sign-in bot check; production sign-in fails closed without it.");
  need("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "Public half of the Turnstile keys.");

  const site = env.NEXT_PUBLIC_SITE_URL;
  if (!present(site) || /localhost|127\.0\.0\.1/.test(site!)) {
    issues.push({
      level: "required",
      name: "NEXT_PUBLIC_SITE_URL",
      message: "Must be the public https URL (used in share images, RSS, sitemap and emails).",
    });
  } else if (!site!.startsWith("https://")) {
    issues.push({ level: "required", name: "NEXT_PUBLIC_SITE_URL", message: "Use https://." });
  }

  if (!present(env.AUTH_GOOGLE_ID) && !present(env.RESEND_API_KEY)) {
    issues.push({
      level: "required",
      name: "AUTH_GOOGLE_ID / RESEND_API_KEY",
      message: "Set at least one sign-in method (Google or email links), or nobody can sign in.",
    });
  }
  if (present(env.AUTH_GOOGLE_ID) !== present(env.AUTH_GOOGLE_SECRET)) {
    issues.push({
      level: "required",
      name: "AUTH_GOOGLE_SECRET",
      message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET must be set together.",
    });
  }

  const r2 = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_URL",
  ];
  const missingR2 = r2.filter((n) => !present(env[n]));
  if (missingR2.length > 0) {
    issues.push({
      level: "required",
      name: missingR2.join(", "),
      message: "File storage: without it uploads fail in production (there is no local fallback).",
    });
  }

  want("NEXT_PUBLIC_CONTACT_EMAIL", "Shown on Terms/Privacy/About for reports and takedowns.");
  if (!present(env.EMAIL_FROM) || /example\.com/.test(env.EMAIL_FROM ?? "")) {
    issues.push({
      level: "recommended",
      name: "EMAIL_FROM",
      message: "Still the placeholder; emails need a sender on a domain you verified with Resend.",
    });
  }
  const ua = env.MUSICBRAINZ_USER_AGENT ?? "";
  if (!present(ua) || /example\.com|your-contact|set MUSICBRAINZ_USER_AGENT/.test(ua)) {
    issues.push({
      level: "recommended",
      name: "MUSICBRAINZ_USER_AGENT",
      message: "MusicBrainz asks for a real contact address and may block anonymous clients.",
    });
  }
  if (env.NODE_ENV === "development") {
    issues.push({
      level: "recommended",
      name: "NODE_ENV",
      message:
        "Dev-only seed-user sign-in is active when NODE_ENV=development. Vercel sets production.",
    });
  }
  return issues;
}
