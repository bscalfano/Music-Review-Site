"use client";

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
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating profile…" : "Create my profile"}
      </Button>
    </form>
  );
}
