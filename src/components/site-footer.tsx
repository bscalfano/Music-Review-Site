import Link from "next/link";
import { siteConfig } from "@/config/site";

/** Footer links. Legal pages are required once strangers can sign up. */
export function SiteFooter() {
  const link = "hover:text-foreground hover:underline";
  return (
    <footer className="text-muted-foreground mt-16 border-t py-6 text-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4">
        <p>
          © {new Date().getFullYear()} {siteConfig.name}
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/about" className={link}>
            About
          </Link>
          <Link href="/terms" className={link}>
            Terms
          </Link>
          <Link href="/privacy" className={link}>
            Privacy
          </Link>
          <Link href="/guidelines" className={link}>
            Guidelines
          </Link>
          <a href="/rss.xml" className={link}>
            RSS
          </a>
        </nav>
      </div>
    </footer>
  );
}
