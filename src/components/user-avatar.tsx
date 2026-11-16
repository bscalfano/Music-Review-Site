import Image from "next/image";
import { avatarUrl } from "@/lib/profiles/queries";
import { cn } from "@/lib/utils";

export function UserAvatar({
  user,
  size = 40,
  className,
}: {
  user: { handle: string | null; displayName: string | null; image: string | null };
  size?: number;
  className?: string;
}) {
  const src = avatarUrl(user.image);
  const name = user.displayName || user.handle || "?";
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          width={size}
          height={size}
          unoptimized
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
