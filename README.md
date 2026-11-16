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

| Command                             | What it does                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                          | Start the dev server                                                      |
| `pnpm build` / `pnpm start`         | Production build / serve                                                  |
| `pnpm lint` / `pnpm typecheck`      | ESLint / TypeScript                                                       |
| `pnpm format` / `pnpm format:check` | Prettier                                                                  |
| `pnpm test`                         | Unit tests (Vitest)                                                       |
| `pnpm e2e`                          | End-to-end tests (Playwright). Set `E2E_BASE_URL` to test a deployed site |
| `pnpm db:generate`                  | Generate a migration from schema changes                                  |
| `pnpm db:migrate`                   | Apply migrations to `DATABASE_URL`                                        |

First time using Playwright: `pnpm exec playwright install chromium`.

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

## Conventions

- Never edit the database by hand; every schema change is a Drizzle migration.
- Pages never query the DB directly; they call server-only functions in `src/lib/*`.
- Every mutation validates input with Zod and checks authorization on the server.
- Feature flags live in `src/features.ts`.
- The site name appears only in `src/config/site.ts` (a unit test enforces this).
