"use server";

import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { ensureAlbum, type AlbumRow } from "@/lib/albums/ensure-album";
import { searchAlbums } from "@/lib/albums/search";
import { recomputeAlbumStats } from "@/lib/albums/stats";
import { validateHandle } from "@/lib/auth/handles";
import { requireUser } from "@/lib/auth/session";
import { isUniqueViolation } from "@/lib/db-errors";
import { kickJobs } from "@/lib/jobs";
import { albumCoverUrl } from "@/lib/music";
import { coverArtArchiveUrl } from "@/lib/music/coverart";
import { requestBytes } from "@/lib/music/http";
import { toHex } from "@/lib/profiles/contrast";
import { VIEWER_DEFAULT_THEME_COOKIE } from "@/lib/profiles/prefs";
import { appearanceSchema, favoritesSchema, profileDetailsSchema } from "@/lib/profiles/schema";

const { users, profiles, follows, favoriteAlbums, albums } = schema;

export type FormState = {
  ok?: boolean;
  message?: string;
  /** Field name -> message. Link problems use link0 / link1 / link2. */
  errors?: Record<string, string>;
};

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** Turns zod issues into { fieldName: message }, mapping links.N.* onto linkN. */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, index] = issue.path;
    const key =
      first === "links" && typeof index === "number" ? `link${index}` : String(first ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

function refreshProfile(handle: string | null) {
  if (handle) revalidatePath(`/u/${handle}`);
  revalidatePath("/settings");
}

// --- Profile details ------------------------------------------------------------------------

export async function updateProfileDetails(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser({ returnTo: "/settings" });

  const links = [0, 1, 2]
    .map((i) => ({ label: text(formData, `linkLabel${i}`), url: text(formData, `linkUrl${i}`) }))
    .filter((l) => l.label.trim() || l.url.trim());
  const parsed = profileDetailsSchema.safeParse({
    displayName: text(formData, "displayName"),
    bio: text(formData, "bio"),
    pronouns: text(formData, "pronouns"),
    location: text(formData, "location"),
    links,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { displayName, bio, pronouns, location, links: cleanLinks } = parsed.data;
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ displayName, bio }).where(eq(users.id, user.id));
    await tx
      .insert(profiles)
      .values({ userId: user.id, pronouns, location, links: cleanLinks })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { pronouns, location, links: cleanLinks, updatedAt: new Date() },
      });
  });
  refreshProfile(user.handle);
  return { ok: true, message: "Profile saved." };
}

// --- Appearance -----------------------------------------------------------------------------

export async function updateAppearance(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser({ returnTo: "/settings" });
  const parsed = appearanceSchema.safeParse({
    themePreset: text(formData, "themePreset"),
    accentColor: text(formData, "accentColor"),
    gridShowRatings: formData.get("gridShowRatings") === "on",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  await getDb()
    .insert(profiles)
    .values({ userId: user.id, ...parsed.data })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { ...parsed.data, updatedAt: new Date() },
    });
  refreshProfile(user.handle);
  return { ok: true, message: "Appearance saved." };
}

const focalSchema = z.coerce.number().int().min(0).max(100);

export async function updateBannerFocal(value: number): Promise<FormState> {
  const user = await requireUser({ returnTo: "/settings" });
  const parsed = focalSchema.safeParse(value);
  if (!parsed.success) return { errors: { focal: "Pick a position between 0 and 100." } };
  await getDb()
    .insert(profiles)
    .values({ userId: user.id, bannerFocalY: parsed.data })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { bannerFocalY: parsed.data, updatedAt: new Date() },
    });
  refreshProfile(user.handle);
  return { ok: true };
}

/** Viewer-side accessibility preference: show every profile in the default theme. */
export async function setViewerDefaultTheme(enabled: boolean): Promise<void> {
  const store = await cookies();
  if (enabled) {
    store.set(VIEWER_DEFAULT_THEME_COOKIE, "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } else {
    store.delete(VIEWER_DEFAULT_THEME_COOKIE);
  }
}

// --- Privacy and handle ---------------------------------------------------------------------

export async function updatePrivacy(isPrivate: boolean): Promise<FormState> {
  const user = await requireUser({ returnTo: "/settings" });
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ isPrivate }).where(eq(users.id, user.id));
    if (!isPrivate) {
      // Going public: requests that were waiting for approval no longer need it.
      await tx
        .update(follows)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(and(eq(follows.followeeId, user.id), eq(follows.status, "pending")));
    }
  });
  refreshProfile(user.handle);
  return {
    ok: true,
    message: isPrivate
      ? "Your account is private. Existing followers keep their access."
      : "Your account is public. Pending follow requests were approved.",
  };
}

export async function changeHandle(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser({ returnTo: "/settings" });
  const handle = validateHandle(text(formData, "handle"));
  if (!handle.ok) return { errors: { handle: handle.error } };
  if (handle.handle === user.handle) return { ok: true, message: "That's already your handle." };
  try {
    await getDb().update(users).set({ handle: handle.handle }).where(eq(users.id, user.id));
  } catch (err) {
    if (isUniqueViolation(err)) return { errors: { handle: "That handle is taken." } };
    throw err;
  }
  refreshProfile(user.handle);
  refreshProfile(handle.handle);
  return {
    ok: true,
    message: `Your profile is now at /u/${handle.handle}. Old links to it will stop working.`,
  };
}

// --- Four Favorites -------------------------------------------------------------------------

export type AlbumHitDto = {
  mbid: string;
  title: string;
  artistName: string;
  year: string | null;
  coverUrl: string;
  inLibrary: boolean;
};

/** Album search for the picker. Signed-in only, so anonymous traffic can't hit MusicBrainz. */
export async function searchAlbumsAction(
  query: string,
  remote = false,
): Promise<{ results: AlbumHitDto[]; error?: string }> {
  await requireUser({ returnTo: "/settings" });
  const q = String(query).slice(0, 100);
  try {
    const hits = await searchAlbums(q, { remote, limit: 8 });
    return {
      results: hits.map((h) => ({
        mbid: h.mbid,
        title: h.title,
        artistName: h.artist.name,
        year: h.releaseDate?.slice(0, 4) ?? null,
        coverUrl: albumCoverUrl({ mbid: h.mbid, coverKey: h.coverKey ?? null }, 250),
        inLibrary: h.inLibrary,
      })),
    };
  } catch (err) {
    console.error("[albums] search failed", err);
    return { results: [], error: "Search is busy right now. Please try again in a moment." };
  }
}

/** The user's current favorites in the shape the editor needs. */
export async function loadFavoritesForEditor(): Promise<AlbumHitDto[]> {
  const user = await requireUser({ returnTo: "/settings" });
  const rows = await getDb()
    .select({ album: albums, artistName: schema.artists.name, position: favoriteAlbums.position })
    .from(favoriteAlbums)
    .innerJoin(albums, eq(favoriteAlbums.albumId, albums.id))
    .innerJoin(schema.artists, eq(albums.artistId, schema.artists.id))
    .where(eq(favoriteAlbums.userId, user.id))
    .orderBy(favoriteAlbums.position);
  return rows.map(({ album, artistName }) => ({
    mbid: album.mbid,
    title: album.title,
    artistName,
    year: album.releaseDate?.slice(0, 4) ?? null,
    coverUrl: albumCoverUrl(album, 250),
    inLibrary: true,
  }));
}

/**
 * Replaces the user's Four Favorites with `mbids` (in order, 0-4 albums). Albums we haven't seen
 * before are created on the way. The fan counters on every affected album are recomputed in the
 * same transaction as the change.
 */
export async function saveFavorites(mbids: string[]): Promise<FormState> {
  const user = await requireUser({ returnTo: "/settings" });
  const parsed = favoritesSchema.safeParse(mbids);
  if (!parsed.success)
    return { errors: { favorites: parsed.error.issues[0]?.message ?? "Invalid selection." } };

  const resolved: AlbumRow[] = [];
  for (const mbid of parsed.data) {
    const album = await ensureAlbum(mbid);
    if (!album)
      return { errors: { favorites: "One of those albums couldn't be found on MusicBrainz." } };
    resolved.push(album);
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    const previous = await tx
      .select({ albumId: favoriteAlbums.albumId })
      .from(favoriteAlbums)
      .where(eq(favoriteAlbums.userId, user.id));
    await tx.delete(favoriteAlbums).where(eq(favoriteAlbums.userId, user.id));
    if (resolved.length > 0) {
      await tx
        .insert(favoriteAlbums)
        .values(resolved.map((a, i) => ({ userId: user.id, position: i + 1, albumId: a.id })));
    }
    const affected = new Set([...previous.map((p) => p.albumId), ...resolved.map((a) => a.id)]);
    for (const albumId of affected) await recomputeAlbumStats(tx, albumId);
  });

  kickJobs(); // newly created albums need their tracklist and cover fetched
  refreshProfile(user.handle);
  return { ok: true, message: "Favorites saved." };
}

/** Suggests an accent colour from the dominant colour of one of the user's favorite covers. */
export async function suggestAccentFromFavorite(
  position: number,
): Promise<{ color?: string; error?: string }> {
  const user = await requireUser({ returnTo: "/settings" });
  const [fav] = await getDb()
    .select({ mbid: albums.mbid })
    .from(favoriteAlbums)
    .innerJoin(albums, eq(favoriteAlbums.albumId, albums.id))
    .where(and(eq(favoriteAlbums.userId, user.id), inArray(favoriteAlbums.position, [position])))
    .limit(1);
  if (!fav) return { error: "Pick that favorite first." };
  try {
    const { bytes } = await requestBytes(coverArtArchiveUrl(fav.mbid, 250), { timeoutMs: 15_000 });
    const { dominant } = await sharp(Buffer.from(bytes)).stats();
    return { color: toHex([dominant.r, dominant.g, dominant.b]) };
  } catch {
    return { error: "Couldn't read that cover. Try another." };
  }
}
