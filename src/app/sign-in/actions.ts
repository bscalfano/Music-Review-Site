"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEV_LOGIN_ENABLED, providerAvailability, signIn, signOut } from "@/auth";
import { safeRedirectPath } from "@/lib/auth/session";
import { verifyTurnstile } from "@/lib/auth/turnstile";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/**
 * Handles every way of signing in. All real providers are gated by Turnstile; sign-up and
 * sign-in are the same flow (an account is created the first time an email or Google identity
 * is seen), so this is where bot protection for sign-up lives.
 */
export async function signInAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  const redirectTo = safeRedirectPath(formData.get("redirectTo"));
  const back = (error: string) =>
    redirect(`/sign-in?error=${error}&callbackUrl=${encodeURIComponent(redirectTo)}`);

  if (provider === "dev") {
    if (!DEV_LOGIN_ENABLED) back("unavailable");
    await signIn("dev", { identifier: String(formData.get("identifier") ?? ""), redirectTo });
    return;
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  const captchaOk = await verifyTurnstile(formData.get("cf-turnstile-response")?.toString(), ip);
  if (!captchaOk) back("captcha");

  if (provider === "google" && providerAvailability.google) {
    await signIn("google", { redirectTo });
  } else if (provider === "email" && providerAvailability.email) {
    const email = emailSchema.safeParse(formData.get("email"));
    if (!email.success) back("email");
    await signIn("resend", { email: email.data, redirectTo });
  } else {
    back("unavailable");
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
