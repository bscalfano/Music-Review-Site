import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalPage } from "@/components/legal-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <LegalPage title={`About ${siteConfig.name}`} intro={siteConfig.tagline}>
      <section>
        <p>
          {siteConfig.name} is a place to log and review albums, follow other listeners, and see
          what the people you follow think of a record. Reviews have no length limit, albums are
          matched to the open MusicBrainz database, and you can attach a 30-second clip.
        </p>
        <p>
          Album data comes from MusicBrainz and the Cover Art Archive; song clips come from Deezer
          and Apple iTunes. Those services belong to their owners.
        </p>
      </section>
      <section>
        <h2>Rules and contact</h2>
        <ul>
          <li>
            <Link href="/terms" className="underline">
              Terms of Service
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link href="/guidelines" className="underline">
              Community Guidelines
            </Link>
          </li>
          <li>
            Feedback, reports and takedown requests: <ContactLink />
          </li>
        </ul>
      </section>
    </LegalPage>
  );
}
