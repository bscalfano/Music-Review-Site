import type { Metadata } from "next";
import { ContactLink, LegalPage } from "@/components/legal-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Community Guidelines" };

export default function GuidelinesPage() {
  return (
    <LegalPage
      title="Community Guidelines"
      intro={`${siteConfig.name} is for people who love talking about music. Disagree about albums as much as you like; be decent about it.`}
    >
      <section>
        <h2>Do</h2>
        <ul>
          <li>Review honestly, in your own words.</li>
          <li>Argue with the opinion, not the person.</li>
          <li>Use the Report button when something looks wrong. A moderator will look.</li>
          <li>Use blocks and private accounts to shape your own corner of the site.</li>
        </ul>
      </section>

      <section>
        <h2>Don&apos;t</h2>
        <ul>
          <li>Harass, threaten, bully or dogpile anyone.</li>
          <li>Post hate speech or content that targets people for who they are.</li>
          <li>Post sexual or graphically violent content, or anything illegal.</li>
          <li>Spam, advertise, or post the same text over and over.</li>
          <li>Impersonate other people, or pretend to be the artists you review.</li>
          <li>Post other people&apos;s private information.</li>
          <li>Upload images you don&apos;t have the right to share.</li>
          <li>Try to bypass rate limits, scrape private accounts, or attack the site.</li>
        </ul>
      </section>

      <section>
        <h2>What happens when rules are broken</h2>
        <p>
          Moderators can hide reviews, remove comments, reset profile pictures and banners, and
          suspend accounts. Serious or repeated problems can mean a permanent ban. If you think a
          decision was wrong, tell us at <ContactLink /> and we&apos;ll review it.
        </p>
      </section>
    </LegalPage>
  );
}
