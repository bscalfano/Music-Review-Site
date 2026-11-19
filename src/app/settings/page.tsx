import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { FavoritesEditor } from "@/components/profile/favorites-editor";
import { ImageUploader } from "@/components/profile/image-uploader";
import {
  AppearanceForm,
  HandleForm,
  PrivacyForm,
  ProfileDetailsForm,
  ViewerThemePref,
} from "@/components/settings/forms";
import { YourDataSection } from "@/components/settings/account-forms";
import { DELETION_GRACE_DAYS } from "@/lib/account/account";
import {
  BlockedList,
  NotificationPrefsForm,
  SuggestionsForm,
} from "@/components/settings/social-forms";
import { requireUser } from "@/lib/auth/session";
import { listBlocked } from "@/lib/social/blocks";
import { NOTIFICATION_LABELS } from "@/lib/social/notifications";
import { albumCoverUrl } from "@/lib/music";
import { VIEWER_DEFAULT_THEME_COOKIE } from "@/lib/profiles/prefs";
import { avatarUrl, bannerUrl, getFavorites, getProfileByHandle } from "@/lib/profiles/queries";
import { isThemeId } from "@/lib/profiles/themes";
import { getStorage } from "@/lib/storage/r2";

export const metadata: Metadata = { title: "Settings" };

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-20 space-y-4 rounded-xl border p-5"
    >
      <div>
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireUser({ returnTo: "/settings" });
  const data = await getProfileByHandle(user.handle);
  const profile = data?.profile ?? null;
  const favorites = await getFavorites(user.id);
  const viewerDefaultTheme = (await cookies()).get(VIEWER_DEFAULT_THEME_COOKIE)?.value === "1";

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <Link href={`/u/${user.handle}`} className="text-sm underline underline-offset-4">
          View profile
        </Link>
      </div>

      <Section id="profile" title="Profile">
        <ProfileDetailsForm
          defaults={{
            displayName: user.displayName ?? "",
            bio: user.bio ?? "",
            pronouns: profile?.pronouns ?? "",
            location: profile?.location ?? "",
            links: profile?.links ?? [],
          }}
        />
      </Section>

      <Section id="images" title="Avatar and banner">
        <div className="space-y-6">
          <ImageUploader
            kind="avatar"
            currentUrl={avatarUrl(user.image)}
            uploadsEnabled={!!getStorage()}
          />
          <ImageUploader
            kind="banner"
            currentUrl={bannerUrl(profile?.bannerKey ?? null)}
            focalY={profile?.bannerFocalY ?? 50}
            uploadsEnabled={!!getStorage()}
          />
        </div>
      </Section>

      <Section
        id="favorites"
        title="Favorite albums"
        description="Up to four albums, shown at the top of your profile. Drag to reorder."
      >
        <FavoritesEditor
          initial={favorites.map((f) => ({
            mbid: f.album.mbid,
            title: f.album.title,
            artistName: f.artistName,
            year: null,
            coverUrl: albumCoverUrl(f.album, 250),
            inLibrary: true,
          }))}
        />
      </Section>

      <Section
        id="appearance"
        title="Appearance"
        description="Make your profile yours. Colors are adjusted automatically if they'd be hard to read."
      >
        <AppearanceForm
          defaults={{
            themePreset:
              profile && isThemeId(profile.themePreset) ? profile.themePreset : "default",
            accentColor: profile?.accentColor ?? "",
            gridShowRatings: profile?.gridShowRatings ?? true,
          }}
          favoriteTitles={favorites.map((f) => f.album.title)}
        />
      </Section>

      <Section id="privacy" title="Privacy">
        <PrivacyForm isPrivate={user.isPrivate} />
        <div className="mt-4">
          <SuggestionsForm accept={user.acceptSuggestions} />
        </div>
      </Section>

      <Section
        id="notifications"
        title="Notifications"
        description="Choose which activity also reaches your inbox."
      >
        <NotificationPrefsForm
          options={Object.entries(NOTIFICATION_LABELS).map(([type, label]) => ({ type, label }))}
          enabled={user.emailNotifications}
          emailConfigured={!!process.env.RESEND_API_KEY}
        />
      </Section>

      <Section
        id="blocked"
        title="Blocked accounts"
        description="Blocked people can't see your reviews, follow you, comment or like, and you won't see theirs."
      >
        <BlockedList
          people={(await listBlocked(user.id)).map(({ image, ...p }) => ({
            ...p,
            avatar: avatarUrl(image),
          }))}
        />
      </Section>

      <Section id="account" title="Account">
        <HandleForm handle={user.handle} />
        <p className="text-muted-foreground text-sm">Signed in as {user.email}.</p>
      </Section>

      <Section id="data" title="Your data">
        <YourDataSection handle={user.handle} graceDays={DELETION_GRACE_DAYS} />
      </Section>

      <Section id="viewing" title="Viewing">
        <ViewerThemePref enabled={viewerDefaultTheme} />
      </Section>
    </main>
  );
}
