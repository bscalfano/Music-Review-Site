import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { SocialError } from "@/lib/social/follows";
import { getViewableReview, type Actor } from "@/lib/social/comments";
import { checkRateLimit, rateLimitMessage } from "@/lib/social/ratelimit";
import { loadRelation, profileVisibleTo } from "@/lib/social/visibility";
import { MAX_REPORT_DETAILS, REPORT_REASON_SLUGS } from "./reasons";

const { reports, reviews, comments, users, albums } = schema;

export type ReportTarget = (typeof schema.reportTarget.enumValues)[number];

export const reportInputSchema = z.object({
  targetType: z.enum(["review", "comment", "user"]),
  targetId: z.uuid(),
  reason: z.enum(REPORT_REASON_SLUGS),
  details: z
    .string()
    .trim()
    .max(MAX_REPORT_DETAILS, `Keep it under ${MAX_REPORT_DETAILS} characters.`)
    .transform((v) => v || null),
});

/**
 * Files a report. You can only report something you can actually see (so reports can't be used to
 * probe private accounts), not your own content, and each person has at most one open report per
 * target. Returns whether it was new.
 */
export async function createReport(
  reporter: Actor,
  input: z.infer<typeof reportInputSchema>,
): Promise<{ created: boolean }> {
  const { targetType, targetId } = input;
  const db = getDb();

  if (targetType === "review") {
    const found = await getViewableReview(targetId, reporter);
    if (!found) throw new SocialError("not_found", "That review doesn't exist.");
    if (found.review.authorId === reporter.id) {
      throw new SocialError("invalid", "You can't report your own review.");
    }
  } else if (targetType === "comment") {
    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)))
      .limit(1);
    const found = comment && (await getViewableReview(comment.reviewId, reporter));
    if (!comment || !found) throw new SocialError("not_found", "That comment doesn't exist.");
    if (comment.authorId === reporter.id) {
      throw new SocialError("invalid", "You can't report your own comment.");
    }
    const relation = await loadRelation(reporter, comment.authorId);
    if (relation.blockedEitherWay)
      throw new SocialError("not_found", "That comment doesn't exist.");
  } else {
    if (targetId === reporter.id) throw new SocialError("invalid", "You can't report yourself.");
    const [visible] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, targetId), profileVisibleTo(reporter, users)))
      .limit(1);
    if (!visible) throw new SocialError("not_found", "That account doesn't exist.");
  }

  const limit = await checkRateLimit(reporter.id, "report");
  if (!limit.ok) throw new SocialError("rate_limited", rateLimitMessage(limit));

  const inserted = await db
    .insert(reports)
    .values({
      reporterId: reporter.id,
      targetType,
      targetId,
      reason: input.reason,
      details: input.details,
    })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  return { created: inserted.length > 0 };
}

export type ReportGroup = {
  targetType: ReportTarget;
  targetId: string;
  count: number;
  reasons: string[];
  details: string[];
  reporters: string[];
  firstAt: Date;
  lastAt: Date;
  target: TargetPreview | null;
};

export type TargetPreview =
  | {
      kind: "review";
      status: "draft" | "published" | "hidden";
      deleted: boolean;
      title: string | null;
      body: string;
      album: string;
      authorId: string;
      authorHandle: string | null;
      href: string;
    }
  | {
      kind: "comment";
      deleted: boolean;
      body: string;
      authorId: string;
      authorHandle: string | null;
      href: string;
    }
  | {
      kind: "user";
      id: string;
      handle: string | null;
      displayName: string | null;
      status: "active" | "suspended";
      deleted: boolean;
      href: string;
    };

/** Open reports, one entry per reported thing (several reports of the same target are merged). */
export async function listOpenReportGroups(): Promise<ReportGroup[]> {
  const db = getDb();
  const rows = await db
    .select({
      r: reports,
      reporter: users.handle,
    })
    .from(reports)
    .leftJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.status, "open"))
    .orderBy(desc(reports.createdAt))
    .limit(500);

  const groups = new Map<string, ReportGroup>();
  for (const { r, reporter } of rows) {
    const key = `${r.targetType}:${r.targetId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        targetType: r.targetType,
        targetId: r.targetId,
        count: 0,
        reasons: [],
        details: [],
        reporters: [],
        firstAt: r.createdAt,
        lastAt: r.createdAt,
        target: null,
      };
      groups.set(key, g);
    }
    g.count++;
    if (!g.reasons.includes(r.reason)) g.reasons.push(r.reason);
    if (r.details) g.details.push(r.details);
    if (reporter) g.reporters.push(reporter);
    if (r.createdAt < g.firstAt) g.firstAt = r.createdAt;
    if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
  }

  const list = [...groups.values()];
  const ids = (type: ReportTarget) =>
    list.filter((g) => g.targetType === type).map((g) => g.targetId);
  const [reviewRows, commentRows, userRows] = await Promise.all([
    ids("review").length
      ? db
          .select({
            id: reviews.id,
            status: reviews.status,
            deletedAt: reviews.deletedAt,
            title: reviews.title,
            body: reviews.body,
            slug: reviews.slug,
            album: albums.title,
            authorId: users.id,
            authorHandle: users.handle,
          })
          .from(reviews)
          .innerJoin(users, eq(reviews.authorId, users.id))
          .innerJoin(albums, eq(reviews.albumId, albums.id))
          .where(inArray(reviews.id, ids("review")))
      : [],
    ids("comment").length
      ? db
          .select({
            id: comments.id,
            body: comments.body,
            deletedAt: comments.deletedAt,
            authorId: users.id,
            authorHandle: users.handle,
            reviewSlug: reviews.slug,
            reviewHandle: sql<string>`(SELECT handle FROM users WHERE id = ${reviews.authorId})`,
          })
          .from(comments)
          .innerJoin(users, eq(comments.authorId, users.id))
          .innerJoin(reviews, eq(comments.reviewId, reviews.id))
          .where(inArray(comments.id, ids("comment")))
      : [],
    ids("user").length
      ? db
          .select({
            id: users.id,
            handle: users.handle,
            displayName: users.displayName,
            status: users.status,
            deletedAt: users.deletedAt,
          })
          .from(users)
          .where(inArray(users.id, ids("user")))
      : [],
  ]);

  for (const g of list) {
    if (g.targetType === "review") {
      const r = reviewRows.find((x) => x.id === g.targetId);
      if (r) {
        g.target = {
          kind: "review",
          status: r.status,
          deleted: r.deletedAt !== null,
          title: r.title,
          body: r.body,
          album: r.album,
          authorId: r.authorId,
          authorHandle: r.authorHandle,
          href: `/u/${r.authorHandle}/${r.slug}`,
        };
      }
    } else if (g.targetType === "comment") {
      const c = commentRows.find((x) => x.id === g.targetId);
      if (c) {
        g.target = {
          kind: "comment",
          deleted: c.deletedAt !== null,
          body: c.body,
          authorId: c.authorId,
          authorHandle: c.authorHandle,
          href: `/u/${c.reviewHandle}/${c.reviewSlug}#comment-${c.id}`,
        };
      }
    } else {
      const u = userRows.find((x) => x.id === g.targetId);
      if (u) {
        g.target = {
          kind: "user",
          id: u.id,
          handle: u.handle,
          displayName: u.displayName,
          status: u.status,
          deleted: u.deletedAt !== null,
          href: `/u/${u.handle}`,
        };
      }
    }
  }
  return list.sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
}

/** Marks every open report about one target as handled. */
export async function resolveReports(
  adminId: string,
  targetType: ReportTarget,
  targetId: string,
  status: "actioned" | "dismissed",
): Promise<number> {
  const done = await getDb()
    .update(reports)
    .set({ status, resolvedById: adminId, resolvedAt: new Date() })
    .where(
      and(
        eq(reports.targetType, targetType),
        eq(reports.targetId, targetId),
        eq(reports.status, "open"),
      ),
    )
    .returning({ id: reports.id });
  return done.length;
}
