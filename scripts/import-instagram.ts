/**
 * Stages an Instagram export for the owner to review at /admin/import (S3).
 *
 *   pnpm import:instagram path/to/posts_1.json [--match]
 *
 * Reads the posts file (any size), repairs Instagram's broken text encoding, and adds one staged
 * item per post under the owner account (OWNER_EMAIL). Re-running is safe: posts already staged
 * are skipped. With --match it also looks up album suggestions for every post (slow: MusicBrainz
 * allows one request per second), otherwise use "Find matches" on the page.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: pnpm import:instagram path/to/posts_1.json [--match]");
    process.exit(1);
  }

  const { getDb, schema } = await import("../src/db");
  const { stageExport, suggestMatches } = await import("../src/lib/import/service");

  const db = getDb();
  const [owner] = await db
    .select({ id: schema.users.id, handle: schema.users.handle })
    .from(schema.users)
    .where(eq(schema.users.role, "owner"))
    .limit(1);
  if (!owner) {
    console.error("No owner account yet. Sign in once with OWNER_EMAIL, then run this again.");
    process.exit(1);
  }

  const json: unknown = JSON.parse(readFileSync(file, "utf8"));
  const res = await stageExport(owner.id, json);
  console.log(
    `Staged ${res.added} post(s), ${res.duplicates} already there, ${res.skipped} skipped (no date).`,
  );

  if (args.includes("--match") && res.added > 0) {
    const rows = await db
      .select({ id: schema.importItems.id })
      .from(schema.importItems)
      .where(eq(schema.importItems.ownerId, owner.id));
    let n = 0;
    for (const row of rows) {
      await suggestMatches(owner.id, row.id);
      if (++n % 10 === 0) console.log(`Matched ${n}/${rows.length}`);
    }
    console.log("Matching done.");
  }
  console.log("Next: open /admin/import to confirm albums and publish.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
