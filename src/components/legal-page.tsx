import { siteConfig } from "@/config/site";

/** Last time the legal texts were revised. Bump when you edit them. */
export const LEGAL_UPDATED = "November 2026";

/** Shared layout for the Terms, Privacy, Guidelines and About pages. */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">Last updated {LEGAL_UPDATED}</p>
      {intro && <p className="mt-4 text-lg leading-relaxed">{intro}</p>}
      <div className="legal mt-6 space-y-6 leading-relaxed [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
        {children}
      </div>
    </main>
  );
}

/** The contact address as a link, or a plain sentence if none has been configured. */
export function ContactLink() {
  return siteConfig.contactEmail ? (
    <a href={`mailto:${siteConfig.contactEmail}`} className="underline">
      {siteConfig.contactEmail}
    </a>
  ) : (
    <span>the site owner (contact address not set yet)</span>
  );
}
