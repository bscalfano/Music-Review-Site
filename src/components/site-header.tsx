import { Bell, Search } from "lucide-react";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { buttonVariants } from "@/components/ui/button";
import { SearchBox } from "@/components/search-box";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAvatar } from "@/components/user-avatar";
import { signOutAction } from "@/app/sign-in/actions";
import { getCurrentUser, isAdminRole } from "@/lib/auth/session";
import { unreadCount } from "@/lib/social/notifications";

/** The wordmark. Text, not an image, so a rename is one setting (src/config/site.ts). */
export function SiteLogo() {
  return (
    <Link href="/" className="text-lg font-bold tracking-tight">
      {siteConfig.name}
    </Link>
  );
}

const menuItem = "hover:bg-muted block w-full rounded-md px-3 py-1.5 text-left text-sm";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const unread = user?.handle ? await unreadCount(user.id) : 0;
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-4">
          <SiteLogo />
          <nav aria-label="Main" className="text-muted-foreground flex items-center gap-3 text-sm">
            {user?.handle && (
              <Link href="/feed" className="hover:text-foreground">
                Feed
              </Link>
            )}
            <Link href="/discover" className="hover:text-foreground">
              Discover
            </Link>
          </nav>
        </div>
        <div className="hidden w-56 sm:block lg:w-72">
          <SearchBox compact />
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/search"
            aria-label="Search"
            className="hover:bg-muted inline-flex size-8 items-center justify-center rounded-lg sm:hidden"
          >
            <Search className="size-4" aria-hidden />
          </Link>
          {user?.handle && (
            <Link href="/write" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Write
            </Link>
          )}
          {user?.handle && (
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              className="hover:bg-muted relative inline-flex size-8 items-center justify-center rounded-lg"
            >
              <Bell className="size-4" aria-hidden />
              {unread > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          )}
          <ThemeToggle />
          {user ? (
            <details className="relative">
              <summary
                className="focus-visible:ring-ring/50 flex cursor-pointer list-none items-center rounded-full outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden"
                aria-label="Account menu"
              >
                <UserAvatar user={user} size={32} />
              </summary>
              <div className="bg-popover absolute right-0 z-50 mt-2 w-48 rounded-lg border p-1 shadow-md">
                <p className="text-muted-foreground truncate px-3 py-1.5 text-xs">
                  {user.handle ? `@${user.handle}` : user.email}
                </p>
                {user.handle ? (
                  <>
                    <Link className={menuItem} href={`/u/${user.handle}`}>
                      Your profile
                    </Link>
                    <Link className={menuItem} href="/settings">
                      Settings
                    </Link>
                    {isAdminRole(user.role) && (
                      <Link className={menuItem} href="/admin">
                        Admin
                      </Link>
                    )}
                  </>
                ) : (
                  <Link className={menuItem} href="/onboarding">
                    Finish setting up
                  </Link>
                )}
                <form action={signOutAction}>
                  <button type="submit" className={menuItem}>
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <Link href="/sign-in" className={buttonVariants({ size: "sm" })}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
