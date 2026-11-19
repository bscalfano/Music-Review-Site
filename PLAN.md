# Distortion — Build Plan (v4)

> **Status:** All owner decisions are made (Sections 3, 4 and 8). v4 adds **Four Favorites** and **profile customization** (§2.13), plus the working site name "Distortion" (configurable, §2.14). This plan is ready to build.
>
> **For the implementing agent:** build Section 2 (Core) + Section 3 (Included features) + any **ticked** items in Section 4, following the phases in Section 6. Do **not** build anything in Section 5 (Not included).

---

## 1. Goals

A music-review site where **anyone can sign up, review albums, and follow other reviewers**. The owner (Bri) is the first and main reviewer, and their Instagram back catalog is imported on day one.

| Keep from Instagram | Fix from Instagram |
|---|---|
| Scrollable grid of album covers (**square**, not rectangles), per user | No caption character limit — long-form reviews |
| Attach a song clip to a review | Every album tied to a real music database ID |
| Friends can comment, react, follow | "Listen on" links to Spotify / Apple Music / etc. |
| Following feed | Everyone's reviews of the same album on one page |

Design rules:
- **Album identity is shared, opinions are per-user.** One `albums` row per real album (MusicBrainz ID). Many users' reviews hang off it.
- **Every query that shows content is safe for an untrusted author.** User-written content is sanitized. No user content can run code. Every mutation checks ownership on the server.
- **Clean module boundaries + feature flags**, so features can be added or shipped dark without rewrites.

---

## 2. Core (always built)

### 2.1 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Default React framework; server rendering for shareable, SEO-friendly pages |
| Styling | **Tailwind CSS** + **shadcn/ui** | Most common setup; easy to restyle |
| Database | **PostgreSQL** on **Neon** (free tier) | Relational data fits users/follows/reviews well. (Supabase also fine.) |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Type-safe, migrations in git |
| Auth | **Auth.js (NextAuth v5)**, custom adapter, JWT sessions | Google sign-in + email magic link; no passwords stored |
| Email | **Resend** | Magic links + notification emails |
| File storage | **Cloudflare R2** (S3-compatible, free egress) | Cached cover art, avatars, images in reviews |
| Bot protection | **Cloudflare Turnstile** on sign-up | Free, invisible CAPTCHA; stops bulk spam accounts |
| Hosting | **Vercel** | Zero-config for Next.js; preview deploy per branch |
| Background jobs | **Vercel Cron** + a `jobs` table (simple queue) | Rate-limited MusicBrainz/Odesli lookups, notification emails |
| Validation | **Zod** | Shared form + API validation |
| Testing | **Vitest** + **Playwright** | Unit + end-to-end smoke tests |
| Lint/format | ESLint + Prettier | Standard |

Package manager **pnpm**, Node 22 LTS.

> Vercel's free Hobby plan is for non-commercial use only. That's fine for now, but moving to Pro ($20/mo) would be required if the site ever earns money.

### 2.2 Music database integration

- **MusicBrainz** is the source of truth for album identity. Albums store the **release-group MBID**.
- **Cover Art Archive** supplies covers. Each cover is **copied into R2 when the album is first created**, so the grid never depends on a third party.
- Optional per-album platform IDs: `spotifyId`, `appleMusicId`, `deezerId`, `youtubeMusicId`, `tidalId`.
- All lookups go through `src/lib/music/`, which defines a provider interface (`searchAlbums`, `getAlbum`, `getTracks`, `getPreviewClip`, `getPlatformLinks`).

**Rate limits matter now that many users search.** MusicBrainz allows **1 request/second for the whole site** (per IP), not per user. Therefore:
1. Album search checks the **local `albums` table first** (Postgres trigram search). It only goes to MusicBrainz when the user clicks "Search all of MusicBrainz" or there are no local hits.
2. All MusicBrainz calls go through a single server-side throttle (token bucket in Postgres or Upstash Redis) with a proper User-Agent. Search results are cached for 24h.
3. Heavier enrichment (tracklist, genres, cover copy, platform links) runs as a **background job** after the album row is created.

### 2.3 Data model

```
users           id, handle (unique, lowercase), displayName, email, image, bio,
                role ('owner'|'admin'|'member'), status ('active'|'suspended'),
                isPrivate bool default false,                 -- S26
                createdAt, deletedAt?
                (+ Auth.js tables: accounts, sessions, verification_tokens)
                -- `image` = avatar R2 key (or the Google picture until the user uploads one)
profiles        userId (PK), bannerKey?, bannerFocalY (0–100, default 50), pronouns?, location?,
                links jsonb (≤3 × {label, url}), accentColor? (hex), themePreset ('default'|…),
                gridShowRatings bool default true, updatedAt                    -- §2.13
favorite_albums userId, position smallint CHECK (position BETWEEN 1 AND 4), albumId, createdAt
                PK(userId, position), UNIQUE(userId, albumId)                   -- §2.13
follows         followerId, followeeId, status ('pending'|'accepted'), createdAt, acceptedAt?
                PK(followerId, followeeId)                    -- 'pending' only for private accounts
blocks          blockerId, blockedId, createdAt            PK(blockerId, blockedId)

artists         id, mbid (unique), name, sortName, slug
albums          id, mbid (unique), title, slug, artistId, releaseDate, coverKey (R2),
                genres text[], spotifyId?, appleMusicId?, deezerId?, youtubeMusicId?,
                tidalId?, linksResolvedAt?, createdAt
tracks          id, albumId, mbid?, title, position, durationMs, previewUrl?, previewCheckedAt?

album_stats     albumId (PK), ratingCount, ratingSum, histogram int[11] (one bucket per half star 0–5),
                logCount, reviewCount (logs with a body), fanCount (users with it in Four Favorites), updatedAt
                -- updated in the same transaction as any review publish/edit/delete

reviews         id, albumId, authorId, slug, title?, body (markdown, may be empty: S23 logs),
                rating smallint NULL CHECK (rating BETWEEN 0 AND 10),
                clipTrackId?, status ('draft'|'published'), publishedAt, updatedAt,
                importedFrom? ('instagram'), deletedAt?,
                searchVector tsvector (generated)
                UNIQUE(authorId, albumId)          -- see Q3
                UNIQUE(authorId, slug)
tags            id, name (unique, lowercase)
review_tags     reviewId, tagId

comments        id, reviewId, authorId, parentId?, body, createdAt, editedAt?, deletedAt?
reactions       id, userId, targetType ('review'|'comment'), targetId, kind ('heart'), createdAt
                UNIQUE(userId, targetType, targetId, kind)

lists           id, authorId, title, slug, description, ranked bool, year?, status, createdAt
list_items      listId, position, albumId, reviewId?, note?

queue_items     id, ownerId, albumId, suggestedById?, note?, status ('queued'|'reviewed'|'dismissed'), createdAt

notifications   id, recipientId, actorId,
                type ('follow'|'follow_request'|'follow_accepted'|'comment'|'reply'|'reaction'|'suggestion'),
                targetType, targetId, readAt?, createdAt
reports         id, reporterId, targetType ('review'|'comment'|'user'), targetId, reason, status, resolvedById?, createdAt
jobs            id, type, payload jsonb, runAt, attempts, lastError?, doneAt?
```

**Ratings (S1 decision):** 5 stars with halves. Stored as **half-star units in a `smallint` 0–10** (e.g. 3.5★ = 7) to avoid decimal rounding. `0` = **zero stars** and `NULL` = **no rating**, and the two are shown differently ("0★" vs. no stars at all). Averages ignore `NULL`s.

Implementer notes:
- Index `reviews(authorId, publishedAt desc)`, `reviews(albumId, publishedAt desc)`, `reviews(albumId, authorId)`, `follows(followeeId, status)`, `notifications(recipientId, createdAt desc)`, `queue_items(albumId, ownerId)`.
- Soft-delete reviews, comments and users so moderation and account deletion are reversible within a grace period.
- Blocks are enforced in queries: a blocked user can't comment on, react to or follow the blocker, and neither side sees the other's content in feeds.
- Every schema change goes through a Drizzle migration.

### 2.4 Users, profiles & following

- **Sign up** with Google or email magic link, plus Turnstile. The user picks a unique `@handle` on first login (3–20 chars, a–z, 0–9, `_`). A reserved-handle list blocks `admin`, `feed`, `settings`, etc.
- **Profile `/u/[handle]`:** banner, avatar, display name, bio, links, follower/following counts, follow button, **Four Favorites**, then **that user's square cover grid**. Tabs: Reviews · Lists · Queue · Stats. Layout and customization are in §2.13.
- **Follow** is one-way. Following a public account takes effect immediately. **Private accounts (S26):** following one creates a `pending` request, which the owner approves or declines from notifications. Switching an account from private to public auto-approves its pending requests. Switching from public to private keeps existing followers.
- **Visibility is one rule in one place:** `canView(viewer, author)` in `src/lib/social/visibility.ts`, plus a matching SQL filter fragment for list queries. Content is visible if the author is public, the viewer is the author, or the viewer is an *accepted* follower. It is never visible if either user has blocked the other. Admins can see everything for moderation. **Every** content query uses it: profile grid, review pages, feed, discover, search, album page sections, lists, queue, stats, comments and reactions.
  - For private accounts: no RSS, excluded from the sitemap and Discover, review pages are `noindex`, and share images show only the album (no rating or text).
  - Non-followers who view a private profile see the header (avatar, name, counts) and "This account is private", plus a Request to follow button.
  - Ratings from private accounts count toward album averages **anonymously** (see Q7).
  - Visibility gets thorough unit tests covering every combination (public/private × follower/pending/none × blocked).
- **Following feed `/feed`:** reverse-chronological published reviews from people you follow. Each card shows the cover, reviewer, rating, the first ~280 characters of the review and the clip. Paginated with a cursor on `(publishedAt, id)`. The feed is computed at read time ("fan-out on read" via a join on `follows`), which is simple and plenty fast at this scale. Revisit only with thousands of active users.
- **Discover `/discover`:** recent reviews from everyone, plus "most-reviewed albums this week". This also serves as the empty state for new users who follow nobody, with suggested reviewers to follow (starting with the owner).
- **In-app notifications** (bell icon): new follower, comment, reply, reaction, queue suggestion. Optional email notifications per type are set in `/settings` and off by default except comments.
- **Settings `/settings`:** profile (§2.13: avatar, banner, bio, links, favorites, theme), handle, private account, notification prefs, blocked users, **export my data** (JSON) and **delete account**.

### 2.5 Pages

| Route | Purpose |
|---|---|
| `/` | See Q1. ⭐ Default: logged out → Discover; logged in → Following feed |
| `/feed`, `/discover` | As above |
| `/u/[handle]` | Profile: banner, header, Four Favorites, cover grid (tabs: reviews, lists, queue, stats). See §2.13 |
| `/u/[handle]/[slug]` | Full review: cover, album info, rating, body, clip player, platform links, reactions, comments. Open Graph tags + share image |
| `/albums/[slug]-[mbid]` | Album page, Letterboxd-style. **See §2.12** |
| `/albums/[slug]-[mbid]/reviews` | All reviews of the album: `?sort=popular\|recent`, `?filter=following` |
| `/artists/[slug]` (S12) | Artist info + all their albums with average ratings + reviews |
| `/lists/[handle]/[slug]` (S11) | A user's ranked list |
| `/search` (S9) | Search reviews, albums, artists, users |
| `/write`, `/write/[id]` | Review editor (any signed-in user) |
| `/notifications`, `/settings` | |
| `/admin` | Owner/admins only: reports queue, user management, Instagram import |
| `/about`, `/terms`, `/privacy`, `/guidelines` | Static pages (legal pages required once strangers sign up) |

Grids use `aspect-square` tiles (3 columns on mobile, 4–6 on desktop) with `next/image`.

### 2.6 Review editor (`/write`)

- Album picker: local search → MusicBrainz fallback (§2.2).
- Star picker supporting half stars, plus a clear "No rating" toggle that is distinct from 0★.
- Markdown editor with live preview (S7 embeds; see §3).
- Clip track picker (from the album's tracklist; previews resolved per §2.7).
- Tags (S4), save draft / publish, edit, delete.
- One review per user per album (Q3). Opening `/write` for an album you've already reviewed opens your existing review.

### 2.7 Song clip

The clip is a **30-second preview** from **Deezer API** (no auth), with **iTunes Search API** as fallback. Spotify removed previews for new apps in 2024, so it isn't used. The track is matched by artist + title and the resolved `previewUrl` is stored. Expired URLs (403/404) are re-resolved. A small custom audio player appears on review pages, feed cards and (optionally) on grid-tile hover. Only one clip plays at a time site-wide.

### 2.8 Comments & reactions (S15)

- Signed-in users can comment on any published review, with one level of replies. Authors can edit (marked "edited") and delete their own comments.
- The review author can delete comments on their own review. Admins can delete anything.
- Hearts on reviews and comments, with an optimistic UI.
- Rate limits (per user, in Postgres or Upstash): e.g. 10 comments/min, 30 reactions/min, 50 follows/hour, 20 reviews/day.

### 2.9 Safety & moderation (required for open sign-up)

- **Rendering:** markdown is rendered with `react-markdown` + `rehype-sanitize`. There is **no raw HTML and no MDX execution** of user content (see S7).
- **Reports:** a "Report" action on reviews, comments and users feeds the `/admin` reports queue. Admins can hide content and suspend or unsuspend users.
- **Blocks:** see §2.3.
- **Sign-up:** Turnstile, plus email verification via the magic link or Google.
- **Legal:** Terms, Privacy Policy and Community Guidelines pages (plain-language templates; the owner should review them). Minimum age 13. Account deletion hard-deletes personal data after a 30-day grace period.
- **Uploads:** images only (JPEG/PNG/WebP), ≤ 4 MB (Vercel rejects request bodies over 4.5 MB), re-encoded server-side with `sharp` (strips EXIF/location data; animated images are flattened to the first frame), with a quota that is built in: each user has one avatar and one banner, and a new upload replaces and deletes the old file. Avatars and banners can be reported, and admins can reset them to the default.

### 2.10 Project structure

```
src/
  app/                  routes (public, (auth), /write, /settings, /admin, /api)
  components/           grid, review card, star rating, audio player, editor, feed…
  db/                   schema/, migrations/, seed.ts
  lib/
    music/              provider interface + musicbrainz, coverart, deezer, itunes, odesli
    auth/               Auth.js config, session helpers, requireUser/requireAdmin
    reviews/ comments/ social/ (follows, blocks, feed, notifications)
    lists/ queue/ search/ stats/ moderation/ jobs/ storage/ ratelimit/ profiles/ (favorites, theming)
  config/site.ts        site name, tagline, URLs: the ONLY place the name lives (§2.14)
  features.ts           env-driven feature flags
scripts/
  import-instagram.ts   (S3)
tests/
```

Pages and components never query the DB directly; they call server-only functions in `src/lib/*`. Every mutation is a server action or route handler that validates input with Zod and checks authorization.

### 2.11 Non-functional

- Mobile-first, plus light/dark mode.
- Accessibility: automatic alt text on covers, a keyboard-usable star picker and player.
- SEO: sitemap, per-user RSS feeds (`/u/[handle]/rss.xml`) and a site-wide RSS feed.
- Performance: cache public pages with ISR/`revalidateTag`, and invalidate on publish/edit.

### 2.12 Album page (modeled on Letterboxd's film page)

The album page follows the *structure* of Letterboxd's film page: ratings, then what the people you follow thought, then everyone else. It uses our own visual design, not Letterboxd's look or branding.

**Desktop layout (three columns):**
- **Left:** square cover; "Listen on" buttons (S13); clip player.
- **Middle:** title, artist (linked, S12), year, genres; tabs **Tracklist · Details · Genres**.
- **Right, "Your panel"** (signed in): your current stars with **click-to-rate quick log** (S23). Buttons: Write/Edit review · Add to queue · Add to list. Signed-out users see "Sign in to rate".
- **Right, "Ratings" block, directly beneath your panel:**
  - a histogram with 11 bars (0★ to 5★ in half-star steps) and the site average to one decimal place (e.g. "3.8"), with the rating count;
  - **S24:** a second line, "People you follow: ★3.9 · 12 ratings". It's hidden when no one you follow has rated the album.
  - a "N FANS" link in the block header: the number of users with this album in their Four Favorites (§2.13). Like the averages, it counts private accounts anonymously.

**Beneath the averages (main column), in this order:**

1. **Activity from people you follow** (signed in only; hidden when empty)
   - Header: "ACTIVITY FROM PEOPLE YOU FOLLOW", with counts right-aligned, e.g. "12 LISTENED · 2 IN QUEUE".
   - A row of round avatars (~40px), each with **their stars underneath** in small type:
     - a half-star glyph for half ratings;
     - **nothing** for "no rating";
     - a distinct "0★" mark for zero stars.
   - Corner badges on the avatar: a **lines icon** if they wrote a review (body is not empty), versus none for a rating-only log. A **queue icon** marks people who only have the album in their queue (S14); they're listed last, without stars.
   - Ordered by most recent activity. Hover or focus shows a tooltip, e.g. "@handle · ★★★½ · reviewed Mar 3, 2026". Clicking goes to their review (or their queue, for queue-only people).
   - Shows up to 16 avatars on desktop and 8 on mobile (wrapping), then a "+N" chip linking to `/albums/…/reviews?filter=following`.
2. **Reviews from people you follow:** cards only for entries with a written body. Each card shows avatar, name, stars, date, a ~400-character excerpt with "Read more", hearts and comment count. Shows the 3 most recent, then "All N reviews from people you follow →".
3. **Popular reviews** (most hearts, with a recency boost) and **Recent reviews** from everyone. Each shows 5 and excludes reviews already shown in section 2, with a "More" link to `/reviews?sort=…`.

Signed-out users see sections 3 only, with the prompt "Sign in to see what people you follow think".

**Mobile:** the columns stack in this order: cover + title, ratings block, activity from people you follow, reviews from people you follow, then tracklist and the rest. "Your panel" becomes a sticky bottom bar (stars + Review button).

**Data & rendering:**
- **Averages and histogram** come from `album_stats` (no aggregation at request time).
- **Followed activity** is one query: `follows` (viewer, `accepted`) → `reviews` for this album (published, not deleted) ∪ `queue_items` for this album, with the block filter applied. It returns the user, rating, whether there's a body, and the date. The S24 average is computed from the same rows.
- **Build note (Phase 3):** the album page is rendered per request, not cached with ISR. Review lists depend on the viewer (private accounts, blocks), so a shared cache would need to be split into a cacheable shell plus per-viewer parts. Revisit if traffic ever warrants it.
- ~~**Public parts** cached with ISR~~ (see note above).
- **Personalized parts** (your panel, following activity, following reviews, following average) are rendered dynamically inside `<Suspense>`, so the public page stays cacheable and fast.
- **Components** (reusable later on artist pages and lists): `<RatingHistogram>`, `<FollowingActivityStrip>`, `<ReviewCard variant="excerpt">`, `<StarRating size="xs">`.

### 2.13 Profile page: Four Favorites & customization

**Layout of `/u/[handle]`, top to bottom:**
1. **Banner** (shown 2:1 on phones, 3:1 on wide screens), with the avatar overlapping its bottom-left edge.
2. **Header:** display name, @handle, pronouns, location, links, bio, follower/following counts, Follow button (or Edit profile on your own profile).
3. **Four Favorites:** a "FAVORITE ALBUMS" heading and a row of 4 square covers. The row stays 4 across on mobile, just smaller.
4. **Tabs + cover grid** (Reviews · Lists · Queue · Stats).

**Four Favorites (modeled on Letterboxd):**
- 0–4 albums in a fixed order, stored in `favorite_albums`. Favorites don't need to be reviewed or rated.
- **Editing:** "Edit" on your own profile, or in Settings → Profile. Four slots use the shared `<AlbumPicker>` (local search → MusicBrainz fallback). Drag to reorder (`dnd-kit`), with buttons as a keyboard alternative; × removes an album. Empty slots show a "+" only to the owner; visitors see only the filled ones, and the section is hidden if there are none.
- **Viewing:** hover or focus shows "Title — Artist" plus the owner's stars if they rated it. Clicking goes to the owner's review of that album if there is one, otherwise to the album page.
- **Album "fans":** `album_stats.fanCount` is kept in the same transaction as favorite edits. It's shown on album pages as "N FANS" (§2.12) and links to `/albums/…/fans`, a list of fans you're allowed to see, with people you follow first.
- **Visibility:** on a private profile, non-followers don't see favorites.
- **Profile share image (S22)** shows the avatar, name and the Four Favorites.

**Customization (Q5):**
| Option | Details |
|---|---|
| Avatar | Upload, crop to a square in the browser (`react-easy-crop`), stored at 400px and shown as a circle. Defaults to the Google picture or a generated initial. |
| Banner | Upload, crop to 2:1, stored at 1500×750 and 750×375. Phones show it whole; wide screens show it 3:1, cropped vertically around a focal-point slider the user sets. Optional: with no banner, a gradient is generated from the accent color. |
| Display name, pronouns, location | Name 1–50 chars; pronouns ≤ 20; location ≤ 40. All optional except the name. |
| Bio | ≤ 300 chars, plain text with line breaks, auto-linked URLs and @mentions. No markdown. |
| Links | Up to 3 `https` links with labels. Known sites (Instagram, Spotify, Bandcamp, etc.) get icons. Rendered with `rel="nofollow ugc noopener"`. |
| Accent color | 12 preset swatches, a custom hex value, or **"Match a favorite"**, which suggests the dominant color of one of your Four Favorites (extracted with `sharp`). Used for links, buttons, stars and the tab underline on your profile, and as the accent on your review pages. |
| Theme preset | A full color scheme for your profile page, e.g. **Default · Midnight · Paper · Neon · Vinyl**. Each preset defines light *and* dark variants as CSS variables scoped to the profile container. More presets can be added in one file. |
| Grid options | Show/hide star ratings on cover tiles. |

Rules for the implementer:
- **No custom CSS, HTML or fonts from users.** These are XSS and phishing risks. All theming is through the fixed options above, applied as CSS variables.
- **The contrast check is enforced.** The accent must reach WCAG AA (4.5:1) against the preset background in both light and dark mode. If it doesn't, its lightness is auto-adjusted and the settings preview shows the adjusted color.
- **Viewers can opt out:** a viewer setting, "Show profiles in the default theme" (accessibility).
- **Live preview:** the settings page shows a live preview of the profile before saving.
- **One place for themes:** presets and their tokens live in `src/lib/profiles/themes.ts`.

### 2.14 Site name: "Distortion" (working name, must be easy to change)

- `src/config/site.ts` exports `siteConfig = { name, shortName, tagline, url, emailFrom }`. `name` reads `NEXT_PUBLIC_SITE_NAME` and falls back to `"Distortion"`.
- **Every** use of the name reads `siteConfig`: page titles/metadata, the `<SiteLogo>` wordmark component (text, not an image), emails, share images, RSS, the web manifest, and the Terms/Privacy pages.
- A unit test fails if the literal string "Distortion" appears anywhere in `src/` outside `config/site.ts`.
- Renaming then means changing one env var (plus the domain, S20).

---

## 3. Included features (owner-selected), with implementation notes

| # | Feature | Notes after the multi-user change |
|---|---|---|
| **S1** | 5 stars with halves; 0★ and "no rating" are distinct | Covered in §2.3 / §2.6 |
| **S3** | Instagram import | **Owner-only** script + `/admin/import` review screen. It parses the Instagram JSON export (posts, captions, timestamps, image), creates drafts with `importedFrom='instagram'` and the original date as `publishedAt`, and **guesses the album** from the caption (e.g. "Album – Artist") via local + MusicBrainz search. The owner confirms or corrects each match, then bulk-publishes. Instagram's exported text can have broken emoji/accents (a known mojibake issue), so the script must repair the encoding. |
| **S4** | Tags / genres | Two separate things: **genres** come from MusicBrainz and are stored on the album, while **tags** are per-review and user-written (lowercase, max 10 per review). Both are filterable. |
| **S7** | Rich review embeds | ⚠ **Changed for safety:** with strangers writing reviews, MDX (which runs code) is not allowed. Instead, use plain markdown + a small allow-list of custom **directives** (`remark-directive`) that render React components: `:::pullquote`, `::track{n=3}` (inline track mention with a play button), and images uploaded to R2. Same experience, no code execution. |
| **S8** | Grid sort/filter | On every profile grid and on Discover: sort by date / rating / release year, filter by year, genre, tag, rating range. Filters live in URL query params so they're shareable. |
| **S9** | Search | Site-wide, using Postgres full-text search on reviews plus trigram search on albums, artists and users. Results are grouped by type. Blocked/suspended content is excluded. |
| **S10** | Stats page | **Per user** (profile Stats tab): rating distribution, reviews per year, top artists, average by decade. Plus album-level rating histograms. |
| **S11** | Year-end lists | Any user can make lists (ranked or unranked, optional year). Items are albums, optionally linked to the user's own review, with notes. |
| **S12** | Artist pages | Shared across users: discography from MusicBrainz, average rating per album, and recent reviews. |
| **S13** | Platform links | Odesli/song.link API, resolved **once per album** in a background job (Odesli allows ~10 req/min without a key) and stored on the album. A "Fix links" button for admins. |
| **S14** | Listening queue | **Per user**: each profile has a public "Up next" queue. Signed-in users can **suggest** an album to someone's queue; the suggestion arrives as a notification. The owner accepts or dismisses it. Publishing a review of a queued album marks it as reviewed. Users can turn suggestions off. |
| **S15** | Reactions | §2.8 |
| **S18** | Multi-user reviews | **Promoted from "later" to core**, along with following and the following feed (§2.4). |
| **S20** | Custom domain | Phase 5. The domain name depends on Q6. |
| **S22** | Share images | Generated at request time with `next/og` (`opengraph-image.tsx`) per review: cover, reviewer handle, stars, album/artist. Also per profile and per list. |
| **S23** | Rating-only logs | The body is optional. A "log" can be stars only, or even just "listened" (no rating, no body). Quick log is one click on the stars in the album page's "Your panel"; the full editor is still available. In feeds and on profiles, logs show as a compact row ("@bri rated *Kid A* ★★★★½"), not a full card. Profile grids show logs and reviews alike, with a lines icon on tiles that have written reviews. |
| **S24** | Following average | §2.12 Ratings block. Computed from the same query as the activity strip. |
| **S26** | Private accounts | §2.4 (follow requests, the `canView` rule). Settings has a "Private account" toggle with a plain explanation of what it hides. |

---

## 4. New suggestions caused by the multi-user change — owner to decide

Tick `[x]` to include.

> S23, S24 and S26 are ticked and now specified in §3 / §2.4 / §2.12.

- [x] **S23 ⭐ "Log" without a written review.** Allow publishing just a star rating (empty body), like Letterboxd. Many people won't write paragraphs, and this makes signing up worthwhile for them and fills album averages faster. Logs show in feeds as a compact row, not a full card.
- [x] **S24 ⭐ "People you follow" average on album pages.** Show the average of the people you follow next to the site average. This replaces the old S17 idea, and it's cheap now that follows exist.
- [ ] **S25 Weekly email digest.** An opt-in Sunday email listing new reviews from people you follow. It brings people back without a social app. (Watch the Resend free tier limit of 100 emails/day; this may need the $20/mo plan if it grows.)
- [x] **S26 Private accounts.** Follow requests must be approved, and reviews are hidden from non-followers. This adds noticeable complexity to every query and the feed, so I'd skip it for v1.
- [ ] **S27 Re-reviews / relistens.** Allow multiple reviews of the same album by the same user over time (dated), with the latest one counting toward averages. Skip for v1 unless you know you want it; it changes the `UNIQUE(authorId, albumId)` constraint.
- [ ] **S28 Owner-featured reviews.** The owner/admins can "feature" reviews from anyone; they're pinned at the top of Discover. Helps curate quality early on.
- [ ] **S29 Album hearts ("Liked").** On Letterboxd you can like a film separately from rating it. This would add a heart on the album itself, shown as a small heart badge on that person's avatar in the activity strip, and a "Liked albums" tab on profiles. Cheap to add: one more `reactions.targetType`.

---

## 5. Not included (kept for possible future use)

- S2 Track-by-track ratings
- S5 "Fries" branding element (worth revisiting with Q6)
- S6 Custom clip upload. Now also a copyright risk at scale, since strangers would be hosting audio.
- S16 Email subscription. Largely replaced by following (and optionally S25).
- S17 Friends' quick ratings. Superseded by S23/S24.
- S19 Scheduled publishing
- S21 Analytics
- Native mobile app, payments/monetization, direct messages, hosting full-length audio

---

## 6. Build phases (for the implementing agent)

Each phase ends with the app building, lint and tests passing, a commit, and a short summary (what was done, what's next, any defaults assumed). Use feature flags for anything visible but unfinished.

**Phase 0 — Setup**
1. `git init`; create the Next.js 15 app (TS, Tailwind, App Router, ESLint, `src/`) with pnpm.
2. Add shadcn/ui, Drizzle, Zod, Vitest, Playwright, Prettier.
3. Create `.env.example`, `README.md` and `src/features.ts`.
4. **Owner action:** create Neon, Resend, Cloudflare (R2 + Turnstile) and Google OAuth credentials and fill in `.env.local`. Stop and list exactly what's missing if anything is.

**Phase 1 — Data + music lookup**
1. Full schema from §2.3 and the first migration.
2. `src/lib/music/` for MusicBrainz (with the global throttle and caching), Cover Art Archive (copied to R2), Deezer, and iTunes.
3. A `jobs` table and a Vercel Cron runner for enrichment jobs.
4. Provider unit tests using recorded fixtures (no live calls).
5. A seed script: 4 users, follow relationships, about 20 albums/reviews, comments.

**Phase 2 — Auth, users, profiles**
1. Auth.js (Google + magic link), Turnstile, handle selection, reserved handles, owner role from the `OWNER_EMAIL` env var.
2. `src/config/site.ts` (§2.14). Profile page per §2.13: header, avatar/banner upload + crop, bio, links, **Four Favorites** (build the shared `<AlbumPicker>` here, since `/write` reuses it in Phase 3; reorder; `fanCount` upkeep), accent color + theme presets with the contrast check, and the cover grid. Settings (profile, images, favorites, appearance, privacy, handle). **Notification prefs move to Phase 4**, when notifications exist.
3. `requireUser` / `requireAdmin` helpers; Playwright test that protected routes reject anonymous users.
4. The `canView` visibility rule and SQL filter (§2.4), with the full combination unit tests, **before** any content query is written. Every query from here on must use it.

**Phase 3 — Reviews**
1. `/write` editor: `<AlbumPicker>` (from Phase 2), star rating (half stars + no-rating), markdown + S7 directives, clip picker, tags, draft/publish.
2. Review page, clip player, Open Graph tags + S22 share images, S23 quick log.
3. Album page per §2.12 (public parts): layout, `album_stats` maintenance (with tests that publish, edit and delete keep it correct), histogram, popular/recent reviews. Leave placeholders for the personalized sections; these are filled in Phase 4.
3. Sanitization tests: a review body containing `<script>`, `javascript:` links or unknown directives renders safely.

**Phase 4 — Social**
1. Follow/unfollow UI, follower/following lists, blocks, **private accounts + follow requests (S26)**, and the private-account toggle in settings.
2. Album page personalized sections (§2.12): Your panel, activity strip, reviews from people you follow, and the S24 average. Playwright test: user A follows B, B rates an album, A sees B's avatar with the correct stars. A private account C that A doesn't follow never appears.
3. `/feed`, `/discover` (with the new-user empty state), and the home behavior per Q1.
4. Notifications (in-app + optional email via a job), comments + replies, reactions, rate limits.

**Phase 5 — Safety + deploy** *(built: reports, /admin, hide/suspend, account export + 30-day deletion, legal pages, RSS/sitemap, deploy guide in docs/DEPLOY.md. The Vercel deploy, domain and production smoke test are yours to run from that guide: they need your accounts.)*
1. Reports, admin queue, suspend/hide, account export + deletion, Terms/Privacy/Guidelines pages, upload limits.
2. Deploy to Vercel, run production migrations, attach the custom domain (S20).
3. Playwright smoke tests against the deployment: sign-up → write a review → second user follows → it appears in their feed → comment → notification.

**Phase 6 — Owner's back catalog:** S3 Instagram import *(built: `/admin/import` (owner only) + `pnpm import:instagram <posts_1.json>`; staging table `import_items`, mojibake repair, album guessing, per-post confirm, publish keeps the original post date. Not tried against your real export yet.)*

**Phase 7 — Discovery** *(built: S13 "Listen on" links via Deezer/iTunes lookups, plus Odesli when `ODESLI_API_KEY` is set (it answered 401 without a key); S8/S4 sort + filters on profile grids and Discover, in URL params; S9 `/search`; S12 `/artists/[slug]`.)*: S13 platform links → S8 sort/filter → S4 genre/tag filters → S9 search → S12 artist pages.

**Phase 8 — Extras** *(built: S11 lists at `/lists/[handle]/[slug]` with editor at `/write/list`; S14 "Up next" queue with suggestions, accept/dismiss and a settings switch; S10 Stats tab. The ticked Section 4 items (S23, S24, S26) were done in earlier phases. Lists can't be reported yet, only the person who made them.)*: S11 lists → S14 queue + suggestions → S10 stats → any ticked items from Section 4.

---

## 7. Accounts & costs

| Service | Purpose | Cost |
|---|---|---|
| GitHub | Code | Free |
| Vercel | Hosting + cron | Free (Hobby, non-commercial) |
| Neon | Postgres | Free tier (0.5 GB). Should be plenty for a long time |
| Resend | Magic links + notifications | Free: 3,000/mo, **100/day**. Upgrade ($20/mo) if sign-ups or digests exceed this |
| Cloudflare | R2 storage + Turnstile | Free tier (10 GB R2) |
| Google Cloud | OAuth client for "Sign in with Google" | Free |
| Domain (S20) | Custom URL | ~$10–15/yr |

MusicBrainz, Cover Art Archive, Deezer, iTunes and Odesli are free.

---

## 8. Open questions for the owner

1. **What is the home page?** ⭐ Default: a **community site** where logged out you see Discover and logged in you see your Following feed, while your own grid lives at `/u/your-handle`. Alternative: **your personal site first**, where `/` is always your grid and the community lives under `/feed` and `/discover`.
Answer: Default
2. **Who can sign up?** ⭐ Default: **anyone** (with Turnstile + moderation). Alternative: **invite-only** (existing users get invite links) to start small with friends and open up later. Invite-only greatly reduces moderation work early on.
Answer: Default
3. **One review per album per user?** ⭐ Default: yes, editable (S27 would change this).
Answer: Default
4. ~~**Private accounts?**~~ **Answered: yes** (S26 ticked). Specified in §2.4.
7. **Do private accounts' ratings count toward an album's public average?** ⭐ Default: **yes, anonymously** (Letterboxd does the same). Their identity and text stay hidden, but the number feeds the histogram and average. Alternative: exclude them, which makes averages less accurate if many users are private.
Answer: Default
5. **Visual direction:** colors, fonts, vibe (minimal / zine / retro record store)? A screenshot of a site you like helps. *(Unanswered. Default: clean, minimal, cover art carries the color.)*
Answer: Default. However, I want the profile page to be very customizable. That includes profile pictures and bios, of course, but also banner images, and maybe some other options for themeing.
6. **Site name:** now that it's a community rather than a personal account, keep "Bri Guy's Music n Fries" or pick a broader name? It also determines the domain (S20).
Answer: I am still figuring this out. Right now, let's go with "Distortion", but make sure it can be easily changed.
