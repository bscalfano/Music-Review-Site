# Distortion

A music review community: review albums, follow other reviewers, and see what the people you follow think of an album. The site name is a working name and lives in one place: `src/config/site.ts` (override with `NEXT_PUBLIC_SITE_NAME`).

See [PLAN.md](PLAN.md) for the full product and build plan.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · PostgreSQL (Neon) · Drizzle ORM · Auth.js · Resend · Cloudflare R2 · Vercel · Vitest · Playwright

## Local setup

Requires Node 20.17+ (Node 22 LTS recommended) and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env.local   # then fill in the values (see comments in the file)
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command                             | What it does                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Start the dev server                                                                                                             |
| `pnpm build` / `pnpm start`         | Production build / serve                                                                                                         |
| `pnpm lint` / `pnpm typecheck`      | ESLint / TypeScript                                                                                                              |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                         |
| `pnpm test`                         | Unit tests (Vitest)                                                                                                              |
| `pnpm e2e`                          | Access-control tests over HTTP (Playwright; uses a running `pnpm dev` or starts one). Set `E2E_BASE_URL` to test a deployed site |
| `pnpm db:generate`                  | Generate a migration from schema changes                                                                                         |
| `pnpm db:migrate`                   | Apply migrations to `DATABASE_URL`                                                                                               |

Browser-based Playwright tests would need `pnpm exec playwright install chromium` first; the current tests do not.

## Database

Schema lives in `src/db/schema/` (Drizzle). Migrations are in `src/db/migrations/` and are generated, never hand-edited, except `0000_extensions.sql`, which enables `pg_trgm` for fuzzy search.

```bash
pnpm db:generate --name=describe_the_change   # after editing the schema
pnpm db:migrate                               # apply to DATABASE_URL
```

## Seed data (development only)

`pnpm db:seed` creates 4 fake users (one private account), follows, ~20 real albums fetched from MusicBrainz, reviews/logs, comments, reactions, favorites, a queue and a list. It takes a few minutes the first time because MusicBrainz allows one request per second. `pnpm db:unseed` removes the fake users and everything they made (albums and artists are kept). Seed users all have `@seed.invalid` emails. **Do not leave seed data in a database real people use.**

## Music data

- **Album identity** is the MusicBrainz release-group ID. Lookups go through `src/lib/music/`, which defines provider interfaces; each source is one file.
- **MusicBrainz limit:** 1 request/second for the whole site. `throttle.ts` enforces it across all server instances via a row in Postgres, and responses are cached for 24h in `external_cache`. Set `MUSICBRAINZ_USER_AGENT` to your site name plus a real contact address (MusicBrainz asks for this and may block anonymous clients).
- **Covers** are copied into Cloudflare R2 by a background job. Until R2 is configured (or the job has run), `albumCoverUrl()` falls back to the Cover Art Archive.
- **Song clips:** Deezer first, iTunes as fallback. Deezer preview URLs are signed and expire within hours, so `isPreviewFresh()` checks the expiry and callers re-resolve stale URLs.

## Background jobs

Slow work (album tracklists, genres, covers) runs from a Postgres-backed queue (`jobs` table, `src/lib/jobs`). Jobs retry with backoff and are deduplicated by key.

- `kickJobs()` runs due jobs right after a response is sent. This is what keeps the queue moving in practice.
- `/api/cron/jobs` (protected by `CRON_SECRET`) sweeps the queue. `vercel.json` schedules it **once a day**, because that is the most Vercel's free plan allows. It's a safety net for retries, not the primary runner.

## Authentication

Sign-in uses Auth.js (v5) with Google and email links (Resend); both create the account the first time they are used. Each provider only appears once its keys are set in `.env.local` (see `.env.example`). Cloudflare Turnstile guards the sign-in form: it fails closed in production if `TURNSTILE_SECRET_KEY` is missing, and is skipped in development.

- **Owner role:** the account whose email equals `OWNER_EMAIL` becomes `owner` at sign-in.
- **Dev sign-in:** while running `pnpm dev`, the sign-in page lists the seed users so you can sign in as any of them without Google or Resend. This provider does not exist in production builds.
- **Sessions** are JWTs, but the account's current state (suspended, deleted, role) is re-read from the database on every request, so a ban takes effect immediately.
- **Server checks:** use `requireUser()` / `requireAdmin()` from `src/lib/auth/session.ts` in every page and action that needs them. `/admin` answers 404 to non-admins.

## Who can see what

Visibility of a user's content (public vs private accounts, followers, blocks, suspensions) is defined once, in `src/lib/social/visibility.ts`: `canViewContent` for single items and `authorVisibleTo` as a SQL filter for lists. **Every query that shows user content must use it.** `tests/unit/visibility-sql.test.ts` checks that the two agree for every combination against the real database.

## File storage

Avatars, banners and album covers are stored in Cloudflare R2 when the `R2_*` variables are set. In development without them, files go to `public/uploads/` (git-ignored) instead. Uploads are re-encoded server-side (`sharp`), which strips EXIF/location data, and are limited to JPEG/PNG/WebP up to 4 MB.

## Reviews, logs and album pages

- **One row per (author, album):** a rating-only "log" (S23) and a full review are the same row, a log just has an empty body. Writing about an album you already logged edits that row. Soft-deleted rows don't count toward uniqueness.
- **All writes go through `src/lib/reviews/service.ts`** (`saveReview`, `setQuickRating`, `removeLog`, `deleteReview`). Each one recomputes `album_stats` in the same transaction, so averages and histograms are never aggregated at request time. `tests/unit/reviews-service.test.ts` checks publish/edit/unpublish/delete against the real database.
- **Rendering untrusted text:** `src/components/review-body.tsx` renders markdown with `react-markdown` + `rehype-sanitize`. Raw HTML is never parsed, links get `rel="nofollow ugc"`, and images only render if they came from our own upload storage. The only extensions are the directives in `src/lib/markdown/directives.ts` (`:::pullquote`, `::track{n=3}`); unknown directives fall back to the text the author typed. `tests/unit/review-markdown.test.tsx` covers script tags, `javascript:` links, foreign images and directive abuse.
- **Song clips:** `resolveTrackPreview` (`src/lib/albums/previews.ts`) looks a clip up on demand, stores it, and re-resolves expired Deezer URLs. A track with no clip is not searched again for 7 days. Only one clip plays at a time (`src/components/clip-button.tsx`).
- **Review images** are uploaded to `/api/upload/review-image` (re-encoded, max 1600px, EXIF stripped) and stored under `review-images/<userId>/`. There is no per-user quota yet (Phase 5).
- **Album pages** (`/albums/<slug>-<mbid>`) only exist for albums already in our library. They are rendered per request rather than cached, because the review lists depend on who is looking (private accounts). Share images are generated by `opengraph-image.tsx` next to the review page.

## Social features

- **Following** (`src/lib/social/follows.ts`): public accounts follow instantly; private accounts get a `pending` request the owner accepts or declines on `/notifications`. Blocking removes follows both ways and clears notifications between the two. Blocked, suspended and deleted accounts look like they don't exist.
- **Visibility for lists of people** (followers, suggestions) uses `profileVisibleTo` in `visibility.ts`, the SQL twin of `canViewProfileHeader`; the SQL test checks it against the pure rule like the others.
- **Feed and Discover** (`src/lib/social/feed.ts`): the Following feed is a join on `follows` at read time, newest first with a (time, id) cursor. Discover shows written reviews from public accounts only; private accounts never appear there. Home (`/`) sends signed-out visitors to Discover and signed-in users to the feed.
- **Comments, hearts and notifications:** comments are one level deep (`comments.ts`); a comment by someone the viewer can't see is hidden. Hearts and notifications are de-duplicated, and un-hearting or unfollowing retracts the notification. In-app notifications are always on; emails (`notification-email.ts`, a background job) are per type in Settings, default comments and replies only, and are skipped until `RESEND_API_KEY` is set.
- **Rate limits** (`ratelimit.ts`, fixed windows in the `rate_limits` table): 50 follows/hour, 10 comments/minute, 30 hearts/minute, 20 publishes/day, 120 quick ratings/hour.
- **Client components must not import `<UserAvatar>`** (it reads storage and the database through `profiles/queries`). Resolve the URL on the server and use `<AvatarView src=…>`.

## Profile themes

Profiles are customized with fixed options only (preset + accent color); users cannot supply CSS. Presets live in `src/lib/profiles/themes.ts`; add one there and it appears in settings. Accent colors are automatically adjusted to meet WCAG AA contrast against the preset in both light and dark mode.

## Conventions

- Never edit the database by hand; every schema change is a Drizzle migration.
- Pages never query the DB directly; they call server-only functions in `src/lib/*`.
- Every mutation validates input with Zod and checks authorization on the server.
- Feature flags live in `src/features.ts`.
- The site name appears only in `src/config/site.ts` (a unit test enforces this).
