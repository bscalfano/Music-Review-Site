# Deploying to production

This is the checklist for putting the site on Vercel with a real domain. Everything here needs your
own accounts, so it's a list for you to work through; nothing in the repo deploys itself.

Run `pnpm check:env --file=<your env file>` at any point. It lists what's still missing.

## 1. Accounts and keys (do these first)

| Service                  | What to create                                                                                                                                                                                                  | Env vars                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Neon**                 | A _production_ project (keep dev and prod databases separate). Copy the **pooled** connection string.                                                                                                           | `DATABASE_URL`                                                                            |
| **Google Cloud**         | OAuth client (type: Web). Authorized redirect URI: `https://YOUR_DOMAIN/api/auth/callback/google`. Add the same with your `*.vercel.app` URL if you want to test before the domain is attached.                 | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`                                                    |
| **Resend**               | Verify your sending domain (add the SPF and DKIM DNS records it shows). Create an API key.                                                                                                                      | `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Distortion <hello@yourdomain.com>`)                 |
| **Cloudflare Turnstile** | A widget for your domain.                                                                                                                                                                                       | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                                  |
| **Cloudflare R2**        | A bucket, an API token with _Object Read & Write_ on it, and a **public URL** for the bucket (attach a custom domain such as `cdn.yourdomain.com`, which is recommended, or enable the r2.dev URL for testing). | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` |

Other variables:

- `AUTH_SECRET`: a new random secret for production (`npx auth secret`). Don't reuse the dev one.
- `CRON_SECRET`: any long random string. Vercel Cron sends it to `/api/cron/jobs`.
- `OWNER_EMAIL`: your email. The account that signs in with it becomes the owner (admin).
- `NEXT_PUBLIC_SITE_URL`: the public URL, `https://yourdomain.com` (used for share images, RSS, the sitemap and emails).
- `NEXT_PUBLIC_CONTACT_EMAIL`: shown on Terms, Privacy and About for reports and takedown requests.
- `MUSICBRAINZ_USER_AGENT`: `YourSite/1.0 ( you@yourdomain.com )`. MusicBrainz asks for a real contact.
- Do **not** set `NODE_ENV` yourself; Vercel sets `production`, which also switches off the dev-only seed-user sign-in.

## 2. Vercel

1. Push the repo to GitHub, then **Add New → Project** in Vercel and import it.
2. Add every variable above under _Settings → Environment Variables_ (Production).
3. Deploy once. The first build can run before the database has tables; that's fine.
4. **Run the migrations against the production database** from your machine (this is deliberate and
   manual, so a bad deploy can never change your data on its own):

   ```bash
   DATABASE_URL="<production pooled url>" pnpm db:migrate
   ```

   Do this before the first real visit, and again whenever a release includes a new file in
   `src/db/migrations/`. Skipping it makes pages that use the new columns or tables fail with
   database errors.

   For a brand-new production database this applies every migration (`0000` to the latest) in
   order, and that is all you need. Two of them carry data steps worth knowing about:
   - `0006` gives existing published shelves a publish date so they sort in the feed.
   - `0010` adds a "queued at" date to In rotation entries and sets it from the existing created
     date, so old entries don't all show up in the feed as new.
   - `0009` merges "Song clip" into "Favorite song": it copies each clip into the favorite where
     none was set, then drops the old clip column. It can't be undone, so if you ever deploy
     this onto a database with real reviews, back it up first.

   To check what's pending, compare the files in `src/db/migrations/` with the rows in the
   `drizzle.__drizzle_migrations` table.

5. Open `https://YOUR_DEPLOYMENT/api/health`. It should say `{"ok":true}`.
6. Don't run `pnpm db:seed` against production. Seed users are fake and would show up on Discover.

The cron in `vercel.json` runs once a day on the free plan. It retries failed background jobs and
permanently deletes accounts whose 30-day deletion window has passed.

## 3. Custom domain (S20)

_Project → Settings → Domains → Add_, then create the DNS records Vercel shows. When it's live:

- update `NEXT_PUBLIC_SITE_URL` and `AUTH_URL` to the final https URL and redeploy;
- add the production callback URL to your Google OAuth client;
- point `R2_PUBLIC_URL` at your CDN domain if you set one up;
- submit `https://yourdomain.com/sitemap.xml` to Google Search Console if you want to be indexed.

## 4. First sign-in and owner check

1. Sign in with the `OWNER_EMAIL` address (Google or an email link) and pick a handle.
2. Visit `/admin`. You should see the reports queue. Anyone else gets a 404 there.
3. Read the Terms, Privacy and Guidelines pages. **They are plain-language templates, not legal
   advice.** Have them checked, adjust them to your situation, and bump `LEGAL_UPDATED` in
   `src/components/legal-page.tsx`.

## 5. Smoke test (about 10 minutes)

The automated check covers what can run without signing in:

```bash
E2E_BASE_URL=https://yourdomain.com pnpm e2e
```

(The tests marked "needs seed data" skip themselves on a database without the seed users.) Then do
the sign-in flows by hand, ideally with two browsers or one normal and one private window:

1. **Sign up** as a second person (Google or email link). Confirm the bot check appears and you
   land on the onboarding page; agree to the terms and pick a handle.
2. **Write a review** as the owner: search an album, add stars, text and a clip, publish. Open the
   review page and check the cover, the clip button and the share image
   (`/u/HANDLE/SLUG/opengraph-image`).
3. As the second person, **follow the owner**. The owner gets a notification.
4. The owner writes another review. It appears in the second person's **Following feed**.
5. The second person **comments** and **hearts** it. The owner gets two notifications, and (if
   email is on for comments) an email.
6. The second person **reports** the owner's comment. As owner, open `/admin`, remove it, and
   check the activity log.
7. Upload an avatar and a banner in Settings (checks R2). Switch the second account to private and
   confirm the owner's own profile still works while the first can't see the private reviews.
8. **Settings → Download my data** returns a JSON file; **Delete my account** signs you out and the
   profile 404s. Signing in again restores it (within 30 days).

## 6. Keeping it healthy

- **Backups:** Neon keeps point-in-time history on its plans. Check how far back yours goes.
- **Uptime:** point a free monitor (UptimeRobot, Better Stack) at `/api/health`.
- **Rotating secrets:** change `AUTH_SECRET` and everyone is signed out; that's the emergency lever.
- **Spam surge:** lower the limits in `src/lib/social/ratelimit.ts`, or suspend accounts in `/admin/users`.
