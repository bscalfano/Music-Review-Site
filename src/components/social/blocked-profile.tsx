import { ProfileHeader } from "@/components/profile/profile-header";
import type { ProfileRow, UserRow } from "@/lib/profiles/queries";

/**
 * The profile of someone you've blocked: their header with a red Blocked button (click to
 * unblock), and nothing of theirs below it.
 */
export function BlockedProfile({
  user,
  profile,
  counts,
}: {
  user: UserRow;
  profile: ProfileRow | null;
  counts: { followers: number; following: number };
}) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] pb-16">
      <ProfileHeader
        user={user}
        profile={profile}
        counts={counts}
        reviewCount={0}
        isOwner={false}
        viewerId={null}
        followState={null}
        countsVisible={false}
        blockedByViewer
      />
      <main className="mx-auto max-w-md px-4 pt-16 text-center">
        <h2 className="text-2xl font-bold">@{user.handle} is blocked</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          You can&apos;t see their reviews or shelves, and they can&apos;t see yours or follow you.
          Unblock them to see their profile again.
        </p>
      </main>
    </div>
  );
}
