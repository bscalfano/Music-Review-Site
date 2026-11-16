import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default async function OnboardingPage() {
  const user = await requireUser({ allowIncomplete: true, returnTo: "/onboarding" });
  if (user.handle) redirect(`/u/${user.handle}`);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Set up your profile</h1>
        <p className="text-muted-foreground text-sm">
          Pick a name and handle. You can add the rest later.
        </p>
      </div>
      <OnboardingForm defaultName={user.displayName ?? ""} />
    </main>
  );
}
