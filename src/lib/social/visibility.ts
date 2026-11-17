/**
 * THE visibility rule. Every query that shows a user's content (profiles, reviews, feeds,
 * search, album pages, lists, comments, ...) must go through this file; never re-implement it.
 *
 * A viewer can see an author's content when:
 *   - the viewer is an admin (moderation), or
 *   - the viewer is the author, or
 *   - the author is active (not suspended or deleted), AND
 *       neither has blocked the other, AND
 *       the author is public, or the viewer is an *accepted* follower (pending doesn't count).
 *
 * `canViewContent` is the readable definition and is used for single-item checks.
 * `authorVisibleTo` is the same rule as a SQL fragment for list queries; an integration test
 * (tests/unit/visibility-sql.test.ts) checks that the two agree for every combination.
 */
import { and, eq, exists, isNull, not, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type Viewer = { id: string; isAdmin: boolean } | null;
export type FollowState = "accepted" | "pending" | null;
export type AuthorFacts = {
  id: string;
  isPrivate: boolean;
  /** status = 'active' and not deleted */
  active: boolean;
};
export type Relation = { followState: FollowState; blockedEitherWay: boolean };

export function canViewContent(viewer: Viewer, author: AuthorFacts, rel: Relation): boolean {
  if (viewer?.isAdmin) return true;
  if (viewer && viewer.id === author.id) return true;
  if (!author.active) return false;
  if (viewer && rel.blockedEitherWay) return false;
  if (!author.isPrivate) return true;
  return viewer !== null && rel.followState === "accepted";
}

/**
 * Whether the profile *header* (avatar, name, bio, counts) can be shown. Looser than content:
 * a private account's header is visible to everyone who isn't blocked, with a "private" notice
 * and a request-to-follow button in place of the content.
 */
export function canViewProfileHeader(viewer: Viewer, author: AuthorFacts, rel: Relation): boolean {
  if (viewer?.isAdmin) return true;
  if (viewer && viewer.id === author.id) return true;
  if (!author.active) return false;
  return !(viewer && rel.blockedEitherWay);
}

// --- SQL version ----------------------------------------------------------------------------

type AuthorColumns = Pick<typeof schema.users, "id" | "isPrivate" | "status" | "deletedAt">;

/**
 * SQL condition: "the author row `author` is one whose content `viewer` may see".
 * Join the users table (or an alias of it) into the query and pass its columns:
 *
 *   db.select().from(reviews).innerJoin(users, eq(reviews.authorId, users.id))
 *     .where(and(authorVisibleTo(viewer, users), ...))
 */
export function authorVisibleTo(viewer: Viewer, author: AuthorColumns): SQL {
  if (viewer?.isAdmin) return sql`true`;

  const active = and(eq(author.status, "active"), isNull(author.deletedAt));
  if (!viewer) return and(active, eq(author.isPrivate, false))!;

  const acceptedFollower = exists(sql`(
    SELECT 1 FROM follows f
    WHERE f.follower_id = ${viewer.id} AND f.followee_id = ${author.id} AND f.status = 'accepted'
  )`);
  const blockedEitherWay = exists(sql`(
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewer.id} AND b.blocked_id = ${author.id})
       OR (b.blocker_id = ${author.id} AND b.blocked_id = ${viewer.id})
  )`);

  return or(
    eq(author.id, viewer.id),
    and(active, not(blockedEitherWay), or(eq(author.isPrivate, false), acceptedFollower)),
  )!;
}

// --- Single-item helpers (load the facts, then apply the rule) ------------------------------

export async function loadRelation(viewer: Viewer, authorId: string): Promise<Relation> {
  if (!viewer || viewer.id === authorId) return { followState: null, blockedEitherWay: false };
  const db = getDb();
  const [follow] = await db
    .select({ status: schema.follows.status })
    .from(schema.follows)
    .where(and(eq(schema.follows.followerId, viewer.id), eq(schema.follows.followeeId, authorId)))
    .limit(1);
  const [block] = await db
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerId, viewer.id), eq(schema.blocks.blockedId, authorId)),
        and(eq(schema.blocks.blockerId, authorId), eq(schema.blocks.blockedId, viewer.id)),
      ),
    )
    .limit(1);
  return { followState: follow?.status ?? null, blockedEitherWay: !!block };
}

export function authorFacts(user: {
  id: string;
  isPrivate: boolean;
  status: "active" | "suspended";
  deletedAt: Date | null;
}): AuthorFacts {
  return {
    id: user.id,
    isPrivate: user.isPrivate,
    active: user.status === "active" && !user.deletedAt,
  };
}

/**
 * SQL condition for lists of *people* (followers, search, suggestions): the author's profile
 * header may be shown to `viewer`. Looser than `authorVisibleTo`: a private account still
 * appears, but suspended/deleted accounts and blocks (either way) do not. Mirrors
 * `canViewProfileHeader`; tests/unit/visibility-sql.test.ts checks the two agree.
 */
export function profileVisibleTo(viewer: Viewer, author: AuthorColumns): SQL {
  if (viewer?.isAdmin) return sql`true`;
  const active = and(eq(author.status, "active"), isNull(author.deletedAt));
  if (!viewer) return active!;
  const blockedEitherWay = exists(sql`(
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewer.id} AND b.blocked_id = ${author.id})
       OR (b.blocker_id = ${author.id} AND b.blocked_id = ${viewer.id})
  )`);
  return or(eq(author.id, viewer.id), and(active, not(blockedEitherWay)))!;
}
