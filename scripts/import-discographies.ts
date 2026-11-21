/**
 * Copies whole MusicBrainz discographies into the library for artists that already have
 * published reviews or ratings (new reviews do this on their own; this covers the ones written
 * before that existed).
 *
 *   pnpm import:discographies             # every artist with a review that isn't imported yet
 *   pnpm import:discographies --artist=radiohead   # just one, by its slug
 *
 * MusicBrainz allows about one request per second, so a big catalog takes a while: one request
 * per 100 releases. Re-running is safe; finished artists are skipped.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const only = process.argv.find((a) => a.startsWith("--artist="))?.slice("--artist=".length);

  const { and, eq, isNull, sql } = await import("drizzle-orm");
  const { getDb, schema } = await import("../src/db");
  const { importDiscographyPage } = await import("../src/lib/albums/discography");
  const { artists, albums, reviews } = schema;
  const db = getDb();

  const rows = await db
    .selectDistinct({ id: artists.id, name: artists.name, slug: artists.slug })
    .from(artists)
    .innerJoin(albums, eq(albums.artistId, artists.id))
    .innerJoin(
      reviews,
      and(
        eq(reviews.albumId, albums.id),
        eq(reviews.status, "published"),
        isNull(reviews.deletedAt),
      ),
    )
    .where(and(isNull(artists.discographyImportedAt), only ? eq(artists.slug, only) : sql`true`));

  if (rows.length === 0) {
    console.log("Nothing to import.");
    return;
  }
  for (const artist of rows) {
    process.stdout.write(`${artist.name}: `);
    let offset = 0;
    for (;;) {
      await importDiscographyPage(artist.id, offset);
      const [{ done }] = await db
        .select({ done: artists.discographyImportedAt })
        .from(artists)
        .where(eq(artists.id, artist.id));
      process.stdout.write(".");
      if (done) break;
      offset += 100;
    }
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(albums)
      .where(eq(albums.artistId, artist.id));
    console.log(` ${n} releases`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
