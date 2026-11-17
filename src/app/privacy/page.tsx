import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalPage } from "@/components/legal-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`What ${siteConfig.name} collects, why, who else touches it, and how to control it. We try to collect as little as we can.`}
    >
      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account:</strong> your email address, the name and handle you choose, and your
            profile picture if you use Google sign-in or upload one.
          </li>
          <li>
            <strong>What you post:</strong> reviews, ratings, comments, hearts, favorites, tags,
            follows, blocks, and uploaded images. Uploaded images are re-encoded to remove hidden
            data such as location.
          </li>
          <li>
            <strong>Technical data:</strong> standard server logs (IP address, browser, pages
            requested) kept briefly by our hosting provider to keep the site running and secure.
          </li>
          <li>
            <strong>Cookies:</strong> a sign-in cookie, and small preference cookies (such as your
            colour theme). We don&apos;t use advertising or tracking cookies.
          </li>
        </ul>
      </section>

      <section>
        <h2>Who can see it</h2>
        <ul>
          <li>Public accounts: anyone can see your profile, reviews and comments.</li>
          <li>
            Private accounts: only people you approve can see your reviews and favorites. Your star
            ratings still count, anonymously, toward an album&apos;s overall average.
          </li>
          <li>Your email address is never shown to other users.</li>
          <li>Drafts are visible only to you.</li>
        </ul>
      </section>

      <section>
        <h2>Services we use</h2>
        <p>These companies process data on our behalf, each under its own privacy policy:</p>
        <ul>
          <li>Vercel (hosting) and Neon (database).</li>
          <li>Cloudflare (file storage and the bot check on sign-in).</li>
          <li>
            Google (if you choose Google sign-in) and Resend (sign-in and notification emails).
          </li>
          <li>
            MusicBrainz, Cover Art Archive, Deezer and Apple iTunes, which we query for album
            information, covers and 30-second clips. We send them album and artist names, not your
            personal data.
          </li>
        </ul>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>
            <strong>Download your data</strong> as a JSON file, and{" "}
            <strong>delete your account</strong>, both in{" "}
            <Link href="/settings#data" className="underline">
              Settings
            </Link>
            . Deleted accounts are hidden immediately and permanently erased after 30 days.
          </li>
          <li>Edit or delete any review or comment whenever you like.</li>
          <li>Choose which notifications are emailed to you in Settings.</li>
          <li>Block people, and report content that breaks the rules.</li>
        </ul>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          {siteConfig.name} is not for children under 13. If you believe a child has an account,
          please contact us and we&apos;ll remove it.
        </p>
      </section>

      <section>
        <h2>Retention, changes and contact</h2>
        <p>
          We keep your data while your account exists, plus the 30-day deletion window and
          short-lived backups. We&apos;ll note significant changes to this policy on the site. For
          privacy questions or requests, contact <ContactLink />.
        </p>
      </section>
    </LegalPage>
  );
}
