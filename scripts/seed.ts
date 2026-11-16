/**
 * Development seed: 4 fake users (one private), follows, ~20 real albums pulled from
 * MusicBrainz, reviews/logs, comments, reactions, favorites, a queue and a list.
 *
 *   pnpm db:seed      wipes any previous seed data, then seeds
 *   pnpm db:unseed    removes seed users and everything they created
 *
 * Seed users all have emails @seed.invalid, which is how they're found again. Albums and artists
 * are real catalog data and are kept by `db:unseed`.
 */
import { config } from "dotenv";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { enrichAlbum } from "@/lib/albums/enrich";
import { ensureAlbum, type AlbumRow } from "@/lib/albums/ensure-album";
import { recomputeAlbumStats } from "@/lib/albums/stats";
import { getMusic } from "@/lib/music";
import { normalize } from "@/lib/music/preview";

config({ path: ".env.local" });

const SEED_EMAIL_DOMAIN = "@seed.invalid";

const ALBUMS: Array<[title: string, artist: string]> = [
  ["Kid A", "Radiohead"],
  ["In Rainbows", "Radiohead"],
  ["To Pimp a Butterfly", "Kendrick Lamar"],
  ["Rumours", "Fleetwood Mac"],
  ["Discovery", "Daft Punk"],
  ["Currents", "Tame Impala"],
  ["Blonde", "Frank Ocean"],
  ["Homogenic", "Björk"],
  ["Nevermind", "Nirvana"],
  ["The Dark Side of the Moon", "Pink Floyd"],
  ["Lemonade", "Beyoncé"],
  ["Dummy", "Portishead"],
  ["Mezzanine", "Massive Attack"],
  ["Blue", "Joni Mitchell"],
  ["Kind of Blue", "Miles Davis"],
  ["Remain in Light", "Talking Heads"],
  ["Funeral", "Arcade Fire"],
  ["Illinois", "Sufjan Stevens"],
  ["Selected Ambient Works 85-92", "Aphex Twin"],
  ["Madvillainy", "Madvillain"],
];

const USERS = [
  {
    handle: "maya",
    name: "Maya Okafor",
    bio: "Late-night listener. Rating everything on a curve I refuse to explain.",
    isPrivate: false,
    accent: "#e4572e",
    theme: "default",
  },
  {
    handle: "devon",
    name: "Devon Reyes",
    bio: "Vinyl first, streaming when I must.",
    isPrivate: false,
    accent: "#2e86ab",
    theme: "midnight",
  },
  {
    handle: "priya",
    name: "Priya Nair",
    bio: "Jazz, electronic, and whatever my friends make me listen to.",
    isPrivate: false,
    accent: "#7b2cbf",
    theme: "default",
  },
  {
    handle: "sam_private",
    name: "Sam Whitfield",
    bio: "Private account. Request to follow.",
    isPrivate: true,
    accent: "#2a9d8f",
    theme: "paper",
  },
] as const;

const BODIES = [
  "Every time I come back to this one it opens up a little more. The production is **immaculate**, but what gets me is how restrained it stays.\n\n> The second half is where it really earns its place.\n\nFavorite stretch: the middle run of tracks.",
  "I wanted to love this more than I do. There's real craft here, and the opening is hard to beat, but it loses me around the halfway mark.\n\nStill worth a listen, and I expect it'll grow on me.",
  "A classic for a reason. Listening again after a few years away, it holds up *better* than I remembered.\n\nThe sequencing is a masterclass: nothing is wasted, and the quiet moments land because of the loud ones.",
  "Not what I expected, in the best way. Rainy-day music that never turns sleepy.\n\n- Best track: the single, obviously\n- Underrated: the closer\n- Skippable: nothing, really",
  "Short take: great ideas, uneven execution. The highs are really high, though.",
];

const COMMENTS = [
  "Great write-up! The closer is my favorite too.",
  "Hard disagree on the second half, but I love how you explained it.",
  "This one got me through a whole winter.",
  "Adding this to my queue right now.",
  "Underrated pick. Have you heard their earlier stuff?",
  "That pull quote sums it up perfectly.",
];

const TAGS = ["headphones", "rainy-day", "comfort-listen", "road-trip", "late-night", "grower"];

/** Small deterministic PRNG so reseeding produces the same data. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const log = (msg: string) => console.log(`[seed] ${msg}`);

async function removeSeedData() {
  const db = getDb();
  const removed = await db
    .delete(schema.users)
    .where(like(schema.users.email, `%${SEED_EMAIL_DOMAIN}`))
    .returning({ id: schema.users.id });
  // Cascades remove their reviews, comments, follows, favorites, etc. Fix the counters.
  const all = await db.select({ id: schema.albums.id }).from(schema.albums);
  for (const { id } of all) await recomputeAlbumStats(db, id);
  log(`removed ${removed.length} seed users`);
}

async function resolveAlbums(): Promise<AlbumRow[]> {
  const { catalog } = getMusic();
  const resolved: AlbumRow[] = [];
  for (const [title, artist] of ALBUMS) {
    const hits = await catalog.searchAlbums(`${artist} ${title}`, { limit: 15 });
    const wantArtist = normalize(artist);
    const hit =
      hits.find(
        (h) => normalize(h.title) === normalize(title) && normalize(h.artist.name) === wantArtist,
      ) ?? hits.find((h) => normalize(h.artist.name) === wantArtist);
    if (!hit) {
      log(`  ! no MusicBrainz match for "${title}" by ${artist}, skipping`);
      continue;
    }
    const album = await ensureAlbum(hit.mbid);
    if (!album) continue;
    if (!album.enrichedAt) await enrichAlbum(album.id);
    log(`  ${resolved.length + 1}. ${album.title} (${hit.artist.name})`);
    resolved.push(album);
  }
  return resolved;
}

async function seed() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to seed in production");
  }
  const db = getDb();
  await removeSeedData();

  log(
    `resolving ${ALBUMS.length} albums via MusicBrainz (about 1 request/second, this takes a few minutes)`,
  );
  const albums = await resolveAlbums();
  if (albums.length < 8)
    throw new Error(`Only resolved ${albums.length} albums; is MusicBrainz reachable?`);

  // --- users, profiles, favorites -----------------------------------------------------------
  const rand = mulberry32(42);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const shuffled = <T>(arr: T[]) => [...arr].sort(() => rand() - 0.5);

  const users = await db
    .insert(schema.users)
    .values(
      USERS.map((u) => ({
        handle: u.handle,
        displayName: u.name,
        email: `${u.handle}${SEED_EMAIL_DOMAIN}`,
        bio: u.bio,
        isPrivate: u.isPrivate,
        emailVerified: new Date(),
      })),
    )
    .returning();
  const byHandle = Object.fromEntries(users.map((u) => [u.handle!, u]));

  await db.insert(schema.profiles).values(
    USERS.map((u) => ({
      userId: byHandle[u.handle].id,
      accentColor: u.accent,
      themePreset: u.theme,
      location: pick(["Portland, OR", "Leeds, UK", "Toronto", "Austin, TX"]),
      links: [{ label: "Instagram", url: `https://instagram.com/${u.handle}` }],
    })),
  );
  await db.insert(schema.favoriteAlbums).values(
    users.flatMap((u) =>
      shuffled(albums)
        .slice(0, 4)
        .map((a, i) => ({ userId: u.id, position: i + 1, albumId: a.id })),
    ),
  );

  // --- follows ------------------------------------------------------------------------------
  const follow = (from: string, to: string, status: "accepted" | "pending" = "accepted") => ({
    followerId: byHandle[from].id,
    followeeId: byHandle[to].id,
    status,
    acceptedAt: status === "accepted" ? new Date() : null,
  });
  await db.insert(schema.follows).values([
    follow("maya", "devon"),
    follow("maya", "priya"),
    follow("maya", "sam_private"),
    follow("devon", "maya"),
    follow("devon", "sam_private", "pending"), // request to a private account, not yet approved
    follow("priya", "maya"),
    follow("priya", "devon"),
    follow("sam_private", "maya"),
  ]);

  // --- reviews and logs ---------------------------------------------------------------------
  const ratingPool: Array<number | null> = [null, 0, 3, 4, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10];
  // Tags are shared and outlive the seed users, so creating them must be idempotent.
  await db
    .insert(schema.tags)
    .values(TAGS.map((name) => ({ name })))
    .onConflictDoNothing();
  const tagRows = await db
    .select()
    .from(schema.tags)
    .where(inArray(schema.tags.name, [...TAGS]));
  const now = Date.now();
  const DAY = 86_400_000;

  type ReviewRow = typeof schema.reviews.$inferSelect;
  const reviewRows: ReviewRow[] = [];
  for (const user of users) {
    const chosen = shuffled(albums).slice(0, Math.min(9, albums.length));
    const values = chosen.map((album, i) => {
      const isLog = rand() < 0.4;
      const publishedAt = new Date(now - Math.floor(rand() * 120) * DAY - i * 3_600_000);
      return {
        albumId: album.id,
        authorId: user.id,
        slug: album.slug,
        title: !isLog && rand() < 0.5 ? `Thoughts on ${album.title}` : null,
        body: isLog ? "" : pick(BODIES),
        rating: pick(ratingPool),
        status: "published" as const,
        publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      };
    });
    reviewRows.push(...(await db.insert(schema.reviews).values(values).returning()));
  }
  // One unpublished draft, to exercise "drafts never appear anywhere".
  const draftAlbum = albums.find(
    (a) => !reviewRows.some((r) => r.authorId === byHandle.maya.id && r.albumId === a.id),
  );
  if (draftAlbum) {
    await db.insert(schema.reviews).values({
      albumId: draftAlbum.id,
      authorId: byHandle.maya.id,
      slug: draftAlbum.slug,
      body: "Half-written thoughts...",
      rating: 8,
      status: "draft",
    });
  }

  const withBody = reviewRows.filter((r) => r.body !== "");
  await db.insert(schema.reviewTags).values(
    withBody.flatMap((r) =>
      shuffled(tagRows)
        .slice(0, 1 + Math.floor(rand() * 3))
        .map((t) => ({ reviewId: r.id, tagId: t.id })),
    ),
  );

  // --- comments, replies, reactions ---------------------------------------------------------
  const commentRows: Array<typeof schema.comments.$inferSelect> = [];
  for (const review of shuffled(withBody).slice(0, 10)) {
    const author = pick(users.filter((u) => u.id !== review.authorId));
    const [top] = await db
      .insert(schema.comments)
      .values({ reviewId: review.id, authorId: author.id, body: pick(COMMENTS) })
      .returning();
    commentRows.push(top);
    if (rand() < 0.5) {
      const [reply] = await db
        .insert(schema.comments)
        .values({
          reviewId: review.id,
          authorId: review.authorId,
          parentId: top.id,
          body: "Thanks! Glad it resonated.",
        })
        .returning();
      commentRows.push(reply);
    }
  }
  if (commentRows[0]) {
    await db
      .update(schema.comments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.comments.id, commentRows[0].id));
  }
  const reactionRows = reviewRows.flatMap((r) =>
    users
      .filter((u) => u.id !== r.authorId && rand() < 0.25)
      .map((u) => ({ userId: u.id, targetType: "review" as const, targetId: r.id })),
  );
  if (reactionRows.length)
    await db.insert(schema.reactions).values(reactionRows).onConflictDoNothing();

  // --- queue and a list ---------------------------------------------------------------------
  const queueAlbums = shuffled(albums).slice(0, 2);
  await db.insert(schema.queueItems).values([
    { ownerId: byHandle.maya.id, albumId: queueAlbums[0].id },
    {
      ownerId: byHandle.maya.id,
      albumId: queueAlbums[1].id,
      suggestedById: byHandle.devon.id,
      note: "You'd love this one",
    },
  ]);
  const [list] = await db
    .insert(schema.lists)
    .values({
      authorId: byHandle.maya.id,
      title: "Albums I rediscovered",
      slug: "albums-i-rediscovered",
      ranked: true,
      status: "published",
      year: new Date().getFullYear(),
    })
    .returning();
  await db.insert(schema.listItems).values(
    shuffled(albums)
      .slice(0, 3)
      .map((a, i) => ({
        listId: list.id,
        position: i + 1,
        albumId: a.id,
        note: i === 0 ? "Didn't click until my third listen." : null,
      })),
  );

  // --- counters -----------------------------------------------------------------------------
  for (const album of albums) await recomputeAlbumStats(db, album.id);

  const [counts] = await db
    .execute<{ users: string; reviews: string; comments: string }>(
      sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${"%" + SEED_EMAIL_DOMAIN}) AS users,
           (SELECT count(*) FROM reviews) AS reviews, (SELECT count(*) FROM comments) AS comments
  `,
    )
    .then((r) => r.rows);
  log(
    `done: ${counts.users} users, ${counts.reviews} reviews/logs, ${counts.comments} comments, ${albums.length} albums`,
  );
}

async function main() {
  if (process.argv.includes("--remove")) await removeSeedData();
  else await seed();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
