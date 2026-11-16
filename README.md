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

## Conventions

- Never edit the database by hand; every schema change is a Drizzle migration.
- Pages never query the DB directly; they call server-only functions in `src/lib/*`.
- Every mutation validates input with Zod and checks authorization on the server.
- Feature flags live in `src/features.ts`.
- The site name appears only in `src/config/site.ts` (a unit test enforces this).
