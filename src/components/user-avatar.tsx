import { AvatarView } from "@/components/avatar-view";
import { avatarUrl } from "@/lib/profiles/queries";

/** Server-side avatar for a user row: resolves the stored image key to a URL. */
export function UserAvatar({
  user,
  size = 40,
  className,
}: {
  user: { handle: string | null; displayName: string | null; image: string | null };
  size?: number;
  className?: string;
}) {
  return (
    <AvatarView
      src={avatarUrl(user.image)}
      name={user.displayName || user.handle || "?"}
      size={size}
      className={className}
    />
  );
}
