"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { completeOnboarding, type OnboardingState } from "./actions";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    {},
  );
  return (
    <form action={action} className="space-y-4">
      <Field label="Display name" htmlFor="displayName" error={state.errors?.displayName}>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={defaultName}
          maxLength={50}
          required
          autoComplete="name"
        />
      </Field>
      <Field
        label="Handle"
        htmlFor="handle"
        hint="3-20 characters: lowercase letters, numbers, underscores. This is your profile URL, and you can change it later."
        error={state.errors?.handle}
      >
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">@</span>
          <Input
            id="handle"
            name="handle"
            required
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
            autoCapitalize="none"
            autoComplete="username"
          />
        </div>
      </Field>
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="agree" required className="mt-1 size-4" />
          <span>
            I&apos;m at least 13 years old and I agree to the{" "}
            <Link href="/terms" target="_blank" className="underline">
              Terms
            </Link>
            ,{" "}
            <Link href="/privacy" target="_blank" className="underline">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/guidelines" target="_blank" className="underline">
              Community Guidelines
            </Link>
            .
          </span>
        </label>
        {state.errors?.agree && (
          <p role="alert" className="text-destructive text-xs">
            {state.errors.agree}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating profile…" : "Create my profile"}
      </Button>
    </form>
  );
}
