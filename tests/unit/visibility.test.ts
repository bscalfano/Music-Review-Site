import { describe, expect, it } from "vitest";
import {
  canViewContent,
  canViewProfileHeader,
  type AuthorFacts,
  type FollowState,
  type Viewer,
} from "@/lib/social/visibility";

const AUTHOR_ID = "author";
const viewers: Record<string, Viewer> = {
  anonymous: null,
  self: { id: AUTHOR_ID, isAdmin: false },
  admin: { id: "admin", isAdmin: true },
  other: { id: "other", isAdmin: false },
};
const followStates: FollowState[] = [null, "pending", "accepted"];

// Every combination of the inputs the rule depends on.
const cases = Object.entries(viewers).flatMap(([viewerKind, viewer]) =>
  [true, false].flatMap((isPrivate) =>
    [true, false].flatMap((active) =>
      followStates.flatMap((followState) =>
        [true, false].map((blockedEitherWay) => ({
          viewerKind,
          viewer,
          author: { id: AUTHOR_ID, isPrivate, active } satisfies AuthorFacts,
          rel: { followState, blockedEitherWay },
        })),
      ),
    ),
  ),
);

describe("canViewContent: invariants over every combination", () => {
  it("covers the whole matrix", () => {
    expect(cases).toHaveLength(4 * 2 * 2 * 3 * 2);
  });

  it("admins and the author always see the content", () => {
    for (const c of cases.filter((c) => c.viewerKind === "admin" || c.viewerKind === "self")) {
      expect(canViewContent(c.viewer, c.author, c.rel)).toBe(true);
    }
  });

  it("nobody else sees a suspended or deleted author", () => {
    for (const c of cases.filter(
      (c) => !c.author.active && c.viewerKind !== "admin" && c.viewerKind !== "self",
    )) {
      expect(canViewContent(c.viewer, c.author, c.rel)).toBe(false);
    }
  });

  it("a block in either direction hides content from signed-in non-admin others", () => {
    for (const c of cases.filter((c) => c.viewerKind === "other" && c.rel.blockedEitherWay)) {
      expect(canViewContent(c.viewer, c.author, c.rel)).toBe(false);
    }
  });

  it("anonymous viewers see public, active authors only", () => {
    for (const c of cases.filter((c) => c.viewerKind === "anonymous")) {
      expect(canViewContent(c.viewer, c.author, c.rel)).toBe(
        c.author.active && !c.author.isPrivate,
      );
    }
  });

  it("private authors: only accepted followers see content; pending requests and strangers do not", () => {
    const strangers = cases.filter(
      (c) =>
        c.viewerKind === "other" &&
        c.author.isPrivate &&
        c.author.active &&
        !c.rel.blockedEitherWay,
    );
    expect(strangers).toHaveLength(3);
    for (const c of strangers) {
      expect(canViewContent(c.viewer, c.author, c.rel)).toBe(c.rel.followState === "accepted");
    }
  });

  it("public authors: any signed-in, unblocked viewer sees content, followed or not", () => {
    for (const c of cases.filter(
      (c) =>
        c.viewerKind === "other" &&
        !c.author.isPrivate &&
        c.author.active &&
        !c.rel.blockedEitherWay,
    )) {
      expect(canViewContent(c.viewer, c.author, c.rel)).toBe(true);
    }
  });

  it("following a private account who has since blocked you does not grant access", () => {
    expect(
      canViewContent(
        viewers.other,
        { id: AUTHOR_ID, isPrivate: true, active: true },
        { followState: "accepted", blockedEitherWay: true },
      ),
    ).toBe(false);
  });
});

describe("canViewProfileHeader", () => {
  it("shows a private profile's header to non-followers (with a private notice elsewhere)", () => {
    const author = { id: AUTHOR_ID, isPrivate: true, active: true };
    expect(
      canViewProfileHeader(viewers.other, author, { followState: null, blockedEitherWay: false }),
    ).toBe(true);
    expect(canViewProfileHeader(null, author, { followState: null, blockedEitherWay: false })).toBe(
      true,
    );
  });

  it("hides it for blocked, suspended and deleted accounts (except to self and admins)", () => {
    const active = { id: AUTHOR_ID, isPrivate: false, active: true };
    const inactive = { ...active, active: false };
    expect(
      canViewProfileHeader(viewers.other, active, { followState: null, blockedEitherWay: true }),
    ).toBe(false);
    expect(
      canViewProfileHeader(viewers.other, inactive, { followState: null, blockedEitherWay: false }),
    ).toBe(false);
    expect(
      canViewProfileHeader(viewers.self, inactive, { followState: null, blockedEitherWay: false }),
    ).toBe(true);
    expect(
      canViewProfileHeader(viewers.admin, inactive, { followState: null, blockedEitherWay: true }),
    ).toBe(true);
  });
});
