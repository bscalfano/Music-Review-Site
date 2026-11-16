import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
      <p className="text-muted-foreground text-sm">
        We sent you a sign-in link. It works once and expires in 24 hours. If it doesn&apos;t
        arrive, check your spam folder.
      </p>
      <Link href="/sign-in" className="text-sm underline underline-offset-4">
        Back to sign in
      </Link>
    </main>
  );
}
