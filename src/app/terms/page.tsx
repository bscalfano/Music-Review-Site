import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalPage } from "@/components/legal-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These are the rules for using ${siteConfig.name}. By creating an account you agree to them, so please read them.`}
    >
      <section>
        <h2>Who can use {siteConfig.name}</h2>
        <ul>
          <li>You must be at least 13 years old.</li>
          <li>
            You need an account to post. Keep your sign-in secure; you&apos;re responsible for what
            happens under your account.
          </li>
          <li>One person, one account. Don&apos;t impersonate anyone.</li>
        </ul>
      </section>

      <section>
        <h2>Your content</h2>
        <p>
          You own the reviews, comments, images and other things you post. By posting them you give
          us permission to store, display and distribute them on the site (including in feeds, share
          images and RSS) so the service can work. That permission ends when you delete the content
          or your account, apart from short-lived backups and copies other people have already
          shared.
        </p>
        <p>
          Only post things you have the right to post. Album covers and song clips come from
          third-party services and belong to their owners; reviews are your own words.
        </p>
      </section>

      <section>
        <h2>What you can&apos;t do</h2>
        <p>
          Follow our{" "}
          <Link href="/guidelines" className="underline">
            Community Guidelines
          </Link>
          . In short: no harassment, hate, spam, illegal content, or attempts to break or overload
          the site, and no scraping accounts that are private.
        </p>
      </section>

      <section>
        <h2>Moderation</h2>
        <p>
          We can remove content and suspend or delete accounts that break these terms or the
          guidelines, with or without notice. You can report anything you see, and you can block
          people. If you think we made a mistake, contact us and we&apos;ll take another look.
        </p>
      </section>

      <section>
        <h2>Deleting your account</h2>
        <p>
          You can delete your account in Settings at any time. It disappears right away and is
          permanently erased after 30 days (signing in again within 30 days restores it). You can
          also download your data first.
        </p>
      </section>

      <section>
        <h2>No guarantees</h2>
        <p>
          {siteConfig.name} is provided as is. It may be unavailable, change, or lose data. To the
          extent the law allows, we&apos;re not liable for losses from using it. Nothing here limits
          rights you have by law.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms; if the change is significant we&apos;ll say so on the site.
          Using the site after a change means you accept it. Questions, takedown requests or
          complaints: <ContactLink />.
        </p>
      </section>
    </LegalPage>
  );
}
