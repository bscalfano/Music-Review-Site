/**
 * Integration test: runs the SQL visibility filter against the real database and checks that it
 * agrees with the pure `canViewContent` rule for every combination of author state. It creates
 * throwaway users (@vis-test.invalid) and removes them afterwards. Skipped without DATABASE_URL.
 */
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import {
  authorVisibleTo,
  canViewContent,
  canViewProfileHeader,
  profileVisibleTo,
  type FollowState,
  type Viewer,
} from "@/lib/social/visibility";

const { users, follows, blocks } = schema;
const DOMAIN = "@vis-test.invalid";

type AuthorCase = {
  id?: string;
  isPrivate: boolean;
  status: "active" | "suspended";
  deleted: boolean;
  followState: FollowState;
  block: "none" | "viewer_blocks_author" | "author_blocks_viewer";
};

const authorCases: AuthorCase[] = [true, false].flatMap((isPrivate) =>
  (["active", "suspended"] as const).flatMap((status) =>
    [false, true].flatMap((deleted) =>
      ([null, "pending", "accepted"] as FollowState[]).flatMap((followState) =>
        (["none", "viewer_blocks_author", "author_blocks_viewer"] as const).map((block) => ({
          isPrivate,
          status,
          deleted,
          followState,
          block,
        })),
      ),
    ),
  ),
);

describe.skipIf(!process.env.DATABASE_URL)(
  "authorVisibleTo (SQL) agrees with canViewContent",
  () => {
    const db = getDb();
    let viewerId: string;
    let adminId: string;

    beforeAll(async () => {
      await db.delete(users).where(like(users.email, `%${DOMAIN}`)); // leftovers from a crashed run
      const [viewer, admin] = await db
        .insert(users)
        .values([
          { email: `viewer${DOMAIN}`, handle: "vis_viewer" },
          { email: `admin${DOMAIN}`, handle: "vis_admin", role: "admin" },
        ])
        .returning({ id: users.id });
      viewerId = viewer.id;
      adminId = admin.id;

      for (const [i, c] of authorCases.entries()) {
        const [author] = await db
          .insert(users)
          .values({
            email: `author${i}${DOMAIN}`,
            handle: `vis_author_${i}`,
            isPrivate: c.isPrivate,
            status: c.status,
            deletedAt: c.deleted ? new Date() : null,
          })
          .returning({ id: users.id });
        c.id = author.id;
        if (c.followState) {
          await db
            .insert(follows)
            .values({ followerId: viewerId, followeeId: author.id, status: c.followState });
        }
        if (c.block === "viewer_blocks_author") {
          await db.insert(blocks).values({ blockerId: viewerId, blockedId: author.id });
        } else if (c.block === "author_blocks_viewer") {
          await db.insert(blocks).values({ blockerId: author.id, blockedId: viewerId });
        }
      }
    });

    afterAll(async () => {
      await db.delete(users).where(like(users.email, `%${DOMAIN}`));
      await db.$client.end();
    });

    async function visibleIds(viewer: Viewer): Promise<Set<string>> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(like(users.email, `author%${DOMAIN}`), authorVisibleTo(viewer, users)));
      return new Set(rows.map((r) => r.id));
    }

    const expected = (viewer: Viewer) =>
      new Set(
        authorCases
          .filter((c) =>
            canViewContent(
              viewer,
              { id: c.id!, isPrivate: c.isPrivate, active: c.status === "active" && !c.deleted },
              { followState: c.followState, blockedEitherWay: c.block !== "none" },
            ),
          )
          .map((c) => c.id!),
      );

    it("has the full matrix of authors", () => {
      expect(authorCases).toHaveLength(2 * 2 * 2 * 3 * 3);
    });

    it("matches for a signed-in non-admin viewer", async () => {
      const viewer = { id: viewerId, isAdmin: false };
      expect(await visibleIds(viewer)).toEqual(expected(viewer));
    });

    it("matches for an anonymous viewer", async () => {
      expect(await visibleIds(null)).toEqual(expected(null));
    });

    it("matches for an admin (sees everyone)", async () => {
      const viewer = { id: adminId, isAdmin: true };
      const ids = await visibleIds(viewer);
      expect(ids).toEqual(expected(viewer));
      expect(ids.size).toBe(authorCases.length);
    });

    describe("profileVisibleTo (lists of people) agrees with canViewProfileHeader", () => {
      const header = (viewer: Viewer) =>
        new Set(
          authorCases
            .filter((c) =>
              canViewProfileHeader(
                viewer,
                { id: c.id!, isPrivate: c.isPrivate, active: c.status === "active" && !c.deleted },
                { followState: c.followState, blockedEitherWay: c.block !== "none" },
              ),
            )
            .map((c) => c.id!),
        );
      const ids = async (viewer: Viewer) =>
        new Set(
          (
            await db
              .select({ id: users.id })
              .from(users)
              .where(and(like(users.email, `author%${DOMAIN}`), profileVisibleTo(viewer, users)))
          ).map((r) => r.id),
        );

      it("for a signed-in viewer", async () => {
        const viewer = { id: viewerId, isAdmin: false };
        expect(await ids(viewer)).toEqual(header(viewer));
      });
      it("for an anonymous viewer", async () => {
        expect(await ids(null)).toEqual(header(null));
      });
      it("for an admin", async () => {
        const viewer = { id: adminId, isAdmin: true };
        expect(await ids(viewer)).toEqual(header(viewer));
      });
    });

    it("an author always sees themselves, even if suspended", async () => {
      const suspended = authorCases.find((c) => c.status === "suspended" && c.deleted)!;
      const ids = await visibleIds({ id: suspended.id!, isAdmin: false });
      expect(ids.has(suspended.id!)).toBe(true);
    });

    it("is not affected by an unrelated follow in the other direction", async () => {
      // author follows viewer (not the reverse): grants the viewer nothing
      const priv = authorCases.find(
        (c) =>
          c.isPrivate &&
          c.status === "active" &&
          !c.deleted &&
          c.followState === null &&
          c.block === "none",
      )!;
      await db
        .insert(follows)
        .values({ followerId: priv.id!, followeeId: viewerId, status: "accepted" });
      const ids = await visibleIds({ id: viewerId, isAdmin: false });
      expect(ids.has(priv.id!)).toBe(false);
      await db
        .delete(follows)
        .where(and(eq(follows.followerId, priv.id!), eq(follows.followeeId, viewerId)));
    });
  },
);
