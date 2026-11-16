import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { getCurrentUser } from "@/lib/auth/session";

/** Placeholder home. Phase 4 replaces this with the Following feed / Discover. */
export default async function Home() {
  const user = await getCurrentUser();
  // First sign-in lands here: finish setting up the account before anything else.
  if (user && !user.handle) redirect("/onboarding");

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{siteConfig.name}</h1>
      <p className="text-muted-foreground">{siteConfig.tagline}</p>
      {user?.handle ? (
        <Link href={`/u/${user.handle}`} className={buttonVariants()}>
          Go to your profile
        </Link>
      ) : (
        <Link href="/sign-in" className={buttonVariants()}>
          Sign in
        </Link>
      )}
    </main>
  );
}
