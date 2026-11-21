import { ExternalLink, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LinkifiedText } from "@/components/linkified-text";
import { FollowButton } from "@/components/social/follow-button";
import { ProfileMenu } from "@/components/social/profile-menu";
import { UnblockButton } from "@/components/social/unblock-button";
import { ImageEditButton } from "./image-edit-button";
import { ImageUploader } from "./image-uploader";
import { EditProfileButton, ProfileEditProvider, ProfileInfoSwitch } from "./profile-edit";
import { ProfileDetailsForm } from "@/components/settings/forms";
import { getStorage } from "@/lib/storage/r2";
import { UserAvatar } from "@/components/user-avatar";
import type { FollowState } from "@/lib/social/visibility";
import { avatarUrl, bannerUrl, type ProfileRow, type UserRow } from "@/lib/profiles/queries";

export function ProfileHeader({
  user,
  profile,
  counts,
  reviewCount,
  isOwner,
  viewerId,
  followState,
  countsVisible = true,
  blockedByViewer = false,
  muted = false,
}: {
  user: UserRow;
  profile: ProfileRow | null;
  counts: { followers: number; following: number };
  reviewCount: number;
  isOwner: boolean;
  /** Null when nobody is signed in. */
  viewerId: string | null;
  followState: FollowState;
  /** Follower/following lists are hidden for private accounts you can't see. */
  countsVisible?: boolean;
  /** The owner of this page is someone the viewer blocked: show an Unblock control, no reviews. */
  blockedByViewer?: boolean;
  /** The viewer has muted this person (their posts are hidden from the viewer's feeds). */
  muted?: boolean;
}) {
  const banner = bannerUrl(profile?.bannerKey ?? null, "full");
  const details = [profile?.pronouns, profile?.location].filter(Boolean);

  return (
    <ProfileEditProvider>
      <header>
        <div className="mx-auto max-w-5xl sm:px-4 sm:pt-4">
          <div className="relative aspect-[2/1] w-full overflow-hidden sm:aspect-[3/1] sm:rounded-xl">
            {banner ? (
              <Image
                src={banner}
                alt=""
                fill
                priority
                unoptimized
                sizes="100vw"
                className="object-cover"
                style={{ objectPosition: `50% ${profile?.bannerFocalY ?? 50}%` }}
              />
            ) : (
              <div
                className="size-full"
                style={{
                  background:
                    "linear-gradient(135deg, var(--profile-accent, var(--muted-foreground)), color-mix(in oklab, var(--profile-accent, var(--muted-foreground)) 25%, var(--background)))",
                }}
              />
            )}
            {isOwner && (
              <ImageEditButton kind="banner">
                <ImageUploader
                  kind="banner"
                  currentUrl={banner}
                  focalY={profile?.bannerFocalY ?? 50}
                  uploadsEnabled={!!getStorage()}
                />
              </ImageEditButton>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4">
          <div className="-mt-10 flex items-end justify-between gap-4 sm:-mt-14">
            <div className="relative shrink-0 rounded-full">
              <UserAvatar
                user={user}
                size={96}
                className="ring-background size-24 text-3xl ring-4 sm:size-28"
              />
              {isOwner && (
                <ImageEditButton kind="avatar">
                  <ImageUploader
                    kind="avatar"
                    currentUrl={avatarUrl(user.image)}
                    uploadsEnabled={!!getStorage()}
                  />
                </ImageEditButton>
              )}
            </div>
            <div className="mb-2 flex items-center gap-2">
              {isOwner ? (
                <EditProfileButton />
              ) : blockedByViewer ? (
                <>
                  <ProfileMenu targetId={user.id} handle={user.handle ?? ""} blocked />
                  <UnblockButton targetId={user.id} handle={user.handle ?? ""} variant="blocked" />
                </>
              ) : viewerId ? (
                <>
                  <FollowButton
                    targetId={user.id}
                    initial={followState}
                    isPrivate={user.isPrivate}
                  />
                  <ProfileMenu
                    targetId={user.id}
                    handle={user.handle ?? ""}
                    blocked={false}
                    muted={muted}
                  />
                </>
              ) : (
                <Link
                  href={`/sign-in?callbackUrl=${encodeURIComponent(`/u/${user.handle}`)}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  {user.isPrivate ? "Request to follow" : "Follow"}
                </Link>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <ProfileInfoSwitch
              view={
                <>
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                      {user.displayName ?? user.handle}
                    </h1>
                    <p className="text-muted-foreground text-sm">@{user.handle}</p>
                  </div>

                  {details.length > 0 && (
                    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      {profile?.location && <MapPin className="size-3.5" aria-hidden="true" />}
                      {details.join(" · ")}
                    </p>
                  )}

                  {user.bio && (
                    <p className="max-w-prose text-sm leading-relaxed">
                      <LinkifiedText text={user.bio} />
                    </p>
                  )}

                  {profile && profile.links.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {profile.links.map((link) => (
                        <li key={link.url}>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="nofollow ugc noopener noreferrer"
                            className="hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
                          >
                            {link.label}
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              }
              edit={
                isOwner ? (
                  <div className="space-y-5 rounded-xl border p-4">
                    <p className="text-muted-foreground text-sm">
                      Editing @{user.handle}.{" "}
                      <Link href="/settings" className="underline underline-offset-4">
                        Appearance, privacy and account settings
                      </Link>
                    </p>
                    <ProfileDetailsForm
                      defaults={{
                        displayName: user.displayName ?? "",
                        bio: user.bio ?? "",
                        pronouns: profile?.pronouns ?? "",
                        location: profile?.location ?? "",
                        links: profile?.links ?? [],
                      }}
                    />
                  </div>
                ) : null
              }
            />

            <p className="text-muted-foreground text-sm">
              {!blockedByViewer && (
                <>
                  <span className="text-foreground font-semibold">{reviewCount}</span> reviews
                  ·{" "}
                </>
              )}
              {countsVisible ? (
                <>
                  <Link href={`/u/${user.handle}/followers`} className="hover:underline">
                    <span className="text-foreground font-semibold">{counts.followers}</span>{" "}
                    followers
                  </Link>{" "}
                  ·{" "}
                  <Link href={`/u/${user.handle}/following`} className="hover:underline">
                    <span className="text-foreground font-semibold">{counts.following}</span>{" "}
                    following
                  </Link>
                </>
              ) : (
                <>
                  <span className="text-foreground font-semibold">{counts.followers}</span>{" "}
                  followers ·{" "}
                  <span className="text-foreground font-semibold">{counts.following}</span>{" "}
                  following
                </>
              )}
            </p>
          </div>
        </div>
      </header>
    </ProfileEditProvider>
  );
}
