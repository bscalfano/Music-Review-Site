"use client";

import { useActionState, useState, useTransition } from "react";
import {
  changeHandle,
  setViewerDefaultTheme,
  suggestAccentFromFavorite,
  updateAppearance,
  updatePrivacy,
  updateProfileDetails,
  type FormState,
} from "@/app/settings/actions";
import { StarRating } from "@/components/star-rating";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { normalizeHex } from "@/lib/profiles/contrast";
import {
  ACCENT_SWATCHES,
  resolveProfileTheme,
  THEME_PRESETS,
  type ThemeId,
} from "@/lib/profiles/themes";

function Status({ state }: { state: FormState }) {
  if (state.errors?.form)
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.errors.form}
      </p>
    );
  if (!state.message) return null;
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {state.message}
    </p>
  );
}

// --- Profile details ------------------------------------------------------------------------

export function ProfileDetailsForm({
  defaults,
}: {
  defaults: {
    displayName: string;
    bio: string;
    pronouns: string;
    location: string;
    links: Array<{ label: string; url: string }>;
  };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfileDetails, {});
  const [bioLength, setBioLength] = useState(defaults.bio.length);
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <Field label="Display name" htmlFor="displayName" error={e.displayName}>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={defaults.displayName}
          maxLength={50}
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pronouns" htmlFor="pronouns" error={e.pronouns}>
          <Input
            id="pronouns"
            name="pronouns"
            defaultValue={defaults.pronouns}
            maxLength={20}
            placeholder="optional"
          />
        </Field>
        <Field label="Location" htmlFor="location" error={e.location}>
          <Input
            id="location"
            name="location"
            defaultValue={defaults.location}
            maxLength={40}
            placeholder="optional"
          />
        </Field>
      </div>
      <Field
        label="Bio"
        htmlFor="bio"
        error={e.bio}
        hint={`${bioLength}/300. Plain text; links and @mentions are linked automatically.`}
      >
        <Textarea
          id="bio"
          name="bio"
          defaultValue={defaults.bio}
          maxLength={300}
          rows={4}
          onChange={(ev) => setBioLength(ev.target.value.length)}
        />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Links (up to 3)</legend>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Input
                name={`linkLabel${i}`}
                defaultValue={defaults.links[i]?.label ?? ""}
                maxLength={30}
                placeholder="Label"
                aria-label={`Link ${i + 1} label`}
              />
              <Input
                name={`linkUrl${i}`}
                defaultValue={defaults.links[i]?.url ?? ""}
                maxLength={200}
                placeholder="https://…"
                aria-label={`Link ${i + 1} address`}
              />
            </div>
            {e[`link${i}`] && (
              <p role="alert" className="text-destructive text-xs">
                {e[`link${i}`]}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

// --- Appearance -----------------------------------------------------------------------------

export function AppearanceForm({
  defaults,
  favoriteTitles,
}: {
  defaults: { themePreset: ThemeId; accentColor: string; gridShowRatings: boolean };
  favoriteTitles: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateAppearance, {});
  const [preset, setPreset] = useState<ThemeId>(defaults.themePreset);
  const [accent, setAccent] = useState(defaults.accentColor);
  const [suggestError, setSuggestError] = useState<string>();
  const [suggesting, startSuggest] = useTransition();

  const validAccent = normalizeHex(accent);
  const theme = resolveProfileTheme({ preset, accentColor: validAccent });

  return (
    <form action={action} className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Theme</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.values(THEME_PRESETS).map((p) => (
            <label
              key={p.id}
              className="has-[:checked]:border-foreground has-[:focus-visible]:ring-ring/50 cursor-pointer rounded-lg border p-2 text-center text-xs has-[:focus-visible]:ring-3"
            >
              <input
                type="radio"
                name="themePreset"
                value={p.id}
                checked={preset === p.id}
                onChange={() => setPreset(p.id)}
                className="sr-only"
              />
              <span className="mb-1.5 flex h-8 overflow-hidden rounded border" aria-hidden="true">
                <span className="flex-1" style={{ background: p.light.background }} />
                <span className="flex-1" style={{ background: p.dark.background }} />
                <span className="flex-1" style={{ background: p.dark.accent }} />
              </span>
              {p.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Accent color</legend>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setAccent(c)}
              aria-label={`Use ${c}`}
              aria-pressed={validAccent === c}
              className="aria-pressed:ring-foreground focus-visible:ring-ring size-7 rounded-full border-2 border-transparent ring-offset-2 outline-none focus-visible:ring-2 aria-pressed:ring-2"
              style={{ background: c }}
            />
          ))}
          <Input
            name="accentColor"
            value={accent}
            onChange={(ev) => setAccent(ev.target.value)}
            placeholder="#e4572e"
            className="w-28"
            aria-label="Custom accent color"
            maxLength={7}
          />
          {accent && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAccent("")}>
              Reset
            </Button>
          )}
        </div>
        {state.errors?.accentColor && (
          <p role="alert" className="text-destructive text-xs">
            {state.errors.accentColor}
          </p>
        )}
        {favoriteTitles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-muted-foreground text-xs">Match a favorite:</span>
            {favoriteTitles.map((title, i) => (
              <Button
                key={i}
                type="button"
                variant="outline"
                size="xs"
                disabled={suggesting}
                onClick={() =>
                  startSuggest(async () => {
                    const res = await suggestAccentFromFavorite(i + 1);
                    if (res.color) {
                      setAccent(res.color);
                      setSuggestError(undefined);
                    } else setSuggestError(res.error);
                  })
                }
              >
                {title}
              </Button>
            ))}
          </div>
        )}
        {suggestError && (
          <p role="alert" className="text-destructive text-xs">
            {suggestError}
          </p>
        )}
        {theme.accentAdjusted && (
          <p className="text-muted-foreground text-xs">
            We lightened or darkened this color slightly so it stays readable. The preview shows
            what visitors see.
          </p>
        )}
      </fieldset>

      <Label className="flex items-center gap-2 font-normal">
        <input
          type="checkbox"
          name="gridShowRatings"
          defaultChecked={defaults.gridShowRatings}
          className="size-4"
        />
        Show star ratings on my cover grid
      </Label>

      <div className="space-y-2">
        <p className="text-sm font-medium">Preview</p>
        <div
          className="profile-theme overflow-hidden rounded-xl border"
          data-themed={theme.themed}
          style={theme.style as React.CSSProperties}
        >
          <div
            className="h-16"
            style={{
              background:
                "linear-gradient(135deg, var(--profile-accent), color-mix(in oklab, var(--profile-accent) 25%, var(--background)))",
            }}
          />
          <div className="space-y-2 p-4">
            <p className="font-semibold">
              Your Name <span className="text-muted-foreground text-sm font-normal">@handle</span>
            </p>
            <p className="text-muted-foreground text-sm">
              A bit about you, with a{" "}
              <span className="text-(--profile-accent) underline">link</span>.
            </p>
            <StarRating rating={7} size={16} />
            <div className="w-fit border-b-2 border-(--profile-accent) pb-1 text-sm font-semibold">
              Reviews
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save appearance"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

// --- Account: privacy, handle, viewing preference -------------------------------------------

export function PrivacyForm({ isPrivate }: { isPrivate: boolean }) {
  const [value, setValue] = useState(isPrivate);
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Label className="flex items-start gap-3 font-normal">
        <input
          type="checkbox"
          checked={value}
          disabled={pending}
          className="mt-0.5 size-4"
          onChange={(e) => {
            const next = e.target.checked;
            setValue(next);
            start(async () => setMessage((await updatePrivacy(next)).message));
          }}
        />
        <span>
          <span className="font-medium">Private account</span>
          <span className="text-muted-foreground block text-sm">
            New followers need your approval. Only approved followers see your reviews and
            favorites. Your ratings still count, anonymously, toward an album&apos;s overall
            average. Existing followers keep their access.
          </span>
        </span>
      </Label>
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

export function HandleForm({ handle }: { handle: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changeHandle, {});
  return (
    <form action={action} className="space-y-3">
      <Field
        label="Handle"
        htmlFor="handle"
        error={state.errors?.handle}
        hint="3-20 characters: letters, numbers, underscores. Changing it breaks old links to your profile."
      >
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">@</span>
          <Input
            id="handle"
            name="handle"
            defaultValue={handle}
            minLength={3}
            maxLength={20}
            required
            autoCapitalize="none"
            className="max-w-56"
          />
        </div>
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Change handle"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ViewerThemePref({ enabled }: { enabled: boolean }) {
  const [value, setValue] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <Label className="flex items-start gap-3 font-normal">
      <input
        type="checkbox"
        checked={value}
        disabled={pending}
        className="mt-0.5 size-4"
        onChange={(e) => {
          setValue(e.target.checked);
          start(() => setViewerDefaultTheme(e.target.checked));
        }}
      />
      <span>
        <span className="font-medium">Show all profiles in the default theme</span>
        <span className="text-muted-foreground block text-sm">
          Ignores other people&apos;s custom colors, for readability. Applies on this device.
        </span>
      </span>
    </Label>
  );
}
