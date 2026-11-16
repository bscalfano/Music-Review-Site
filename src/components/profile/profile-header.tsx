import { ExternalLink, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LinkifiedText } from "@/components/linkified-text";
import { UserAvatar } from "@/components/user-avatar";
import { bannerUrl, type ProfileRow, type UserRow } from "@/lib/profiles/queries";

export function ProfileHeader({
  user,
  profile,
  counts,
  reviewCount,
  isOwner,
}: {
  user: UserRow;
  profile: ProfileRow | null;
  counts: { followers: number; following: number };
  reviewCount: number;
  isOwner: boolean;
}) {
  const banner = bannerUrl(profile?.bannerKey ?? null, "full");
  const details = [profile?.pronouns, profile?.location].filter(Boolean);

  return (
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
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4">
        <div className="-mt-10 flex items-end justify-between gap-4 sm:-mt-14">
          <UserAvatar
            user={user}
            size={96}
            className="ring-background size-24 text-3xl ring-4 sm:size-28"
          />
          {isOwner && (
            <Link
              href="/settings"
              className={buttonVariants({ variant: "outline", size: "sm", className: "mb-2" })}
            >
              Edit profile
            </Link>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{user.displayName ?? user.handle}</h1>
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

          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-semibold">{reviewCount}</span> reviews ·{" "}
            <span className="text-foreground font-semibold">{counts.followers}</span> followers ·{" "}
            <span className="text-foreground font-semibold">{counts.following}</span> following
          </p>
        </div>
      </div>
    </header>
  );
}
