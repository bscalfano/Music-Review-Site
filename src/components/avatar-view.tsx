import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The avatar circle itself: takes an already-resolved image URL, so it's safe in client
 * components. Server code should use <UserAvatar>, which resolves a user's stored image first.
 */
export function AvatarView({
  src,
  name,
  size = 40,
  className,
}: {
  src: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
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
