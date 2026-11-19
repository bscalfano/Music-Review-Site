"use client";

import { Bold, ImagePlus, Italic, Link2, ListMusic, Quote, TextQuote, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteReviewAction, saveReviewAction } from "@/app/write/actions";
import { ClipButton } from "@/components/clip-button";
import { ReviewBody, type BodyTrack } from "@/components/review-body";
import { StarInput } from "@/components/star-input";
import { ratingLabel } from "@/components/star-rating";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { MAX_BODY, MAX_TAG_LENGTH, MAX_TAGS, normalizeTag } from "@/lib/reviews/schema";
import { cn } from "@/lib/utils";

export type EditorInitial = {
  id: string;
  slug: string;
  body: string;
  rating: number | null;
  clipTrackId: string | null;
  favoriteTrackId: string | null;
  tags: string[];
  status: "draft" | "published";
};

type Props = {
  album: { mbid: string; title: string; artistName: string; coverUrl: string; albumHref: string };
  tracks: BodyTrack[];
  initial: EditorInitial | null;
  imagePrefixes: string[];
  handle: string;
};

export function ReviewEditor({ album, tracks, initial, imagePrefixes, handle }: Props) {
  const router = useRouter();
  const [reviewId, setReviewId] = useState(initial?.id ?? null);
  const [status, setStatus] = useState<"draft" | "published">(initial?.status ?? "draft");
  const [body, setBody] = useState(initial?.body ?? "");
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [clipTrackId, setClipTrackId] = useState<string | null>(initial?.clipTrackId ?? null);
  const [favoriteTrackId, setFavoriteTrackId] = useState<string | null>(
    initial?.favoriteTrackId ?? null,
  );
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setDirty(true);
    };

  // --- Markdown helpers ----------------------------------------------------------------------

  /** Replace the current selection with `fn(selectedText)`, then re-select the result. */
  function edit(
    fn: (selected: string) => { text: string; selectStart?: number; selectEnd?: number },
  ) {
    const el = textarea.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const result = fn(body.slice(s, e));
    const next = body.slice(0, s) + result.text + body.slice(e);
    change(setBody)(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(
        s + (result.selectStart ?? result.text.length),
        s + (result.selectEnd ?? result.text.length),
      );
    });
  }

  const wrap = (mark: string, placeholder: string) => () =>
    edit((sel) => {
      const inner = sel || placeholder;
      return {
        text: `${mark}${inner}${mark}`,
        selectStart: mark.length,
        selectEnd: mark.length + inner.length,
      };
    });

  const quote = (kind: "quote" | "pull") => () =>
    edit((sel) => {
      const inner = sel || (kind === "pull" ? "A line worth highlighting" : "Quoted text");
      if (kind === "pull") {
        const lead = "\n\n:::pullquote\n";
        return {
          text: `${lead}${inner}\n:::\n\n`,
          selectStart: lead.length,
          selectEnd: lead.length + inner.length,
        };
      }
      return { text: inner.replace(/^/gm, "> ") };
    });

  const link = () =>
    edit((sel) => {
      const label = sel || "link text";
      return {
        text: `[${label}](https://)`,
        selectStart: label.length + 3,
        selectEnd: label.length + 11,
      };
    });

  const insertTrack = (position: number) =>
    edit(() => ({ text: `\n\n::track{n=${position}}\n\n` }));

  async function uploadImage(file: File) {
    setUploading(true);
    setMessage(undefined);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/upload/review-image", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setMessage({ kind: "error", text: json.error ?? "Upload failed." });
        return;
      }
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "image";
      edit(() => ({ text: `\n\n![${alt}](${json.url})\n\n` }));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // --- Tags ----------------------------------------------------------------------------------

  function commitTag(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag || tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setMessage({ kind: "error", text: `Use at most ${MAX_TAGS} tags.` });
      return;
    }
    change(setTags)([...tags, tag]);
    setTagDraft("");
  }

  // --- Saving --------------------------------------------------------------------------------

  function save(nextStatus: "draft" | "published") {
    setMessage(undefined);
    startTransition(async () => {
      const res = await saveReviewAction({
        albumMbid: album.mbid,
        reviewId,
        body,
        rating,
        clipTrackId,
        favoriteTrackId,
        tags,
        status: nextStatus,
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: res.message });
        return;
      }
      setDirty(false);
      setReviewId(res.id);
      setStatus(res.status);
      if (res.status === "published") {
        router.push(`/u/${res.handle}/${res.slug}`);
      } else {
        setMessage({ kind: "ok", text: "Draft saved. Only you can see it." });
        if (!reviewId) router.replace(`/write/${res.id}`);
      }
    });
  }

  function remove() {
    if (!reviewId) return;
    if (!confirm("Delete this review? This can't be undone from the site.")) return;
    startTransition(async () => {
      const res = await deleteReviewAction(reviewId);
      if (res.ok) {
        setDirty(false);
        router.push(`/u/${handle}`);
      } else setMessage({ kind: "error", text: "Couldn't delete the review." });
    });
  }

  const clipTrack = tracks.find((t) => t.id === clipTrackId) ?? null;
  const published = status === "published";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header className="flex items-center gap-4">
        <div className="bg-muted relative size-20 shrink-0 overflow-hidden rounded-lg">
          <Image
            src={album.coverUrl}
            alt={`Cover of ${album.title}`}
            fill
            sizes="80px"
            unoptimized
            className="object-cover"
          />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {reviewId ? (published ? "Editing review" : "Editing draft") : "New review"}
          </p>
          <h1 className="truncate text-xl font-bold">
            <Link href={album.albumHref} className="hover:underline">
              {album.title}
            </Link>
          </h1>
          <p className="text-muted-foreground truncate text-sm">{album.artistName}</p>
        </div>
      </header>

      <section aria-labelledby="rating-heading" className="space-y-2">
        <h2 id="rating-heading" className="text-sm font-medium">
          Your rating
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StarInput value={rating} onChange={change(setRating)} size={34} />
          <div className="flex items-center gap-2" role="group" aria-label="Special ratings">
            <Button
              type="button"
              size="sm"
              variant={rating === 0 ? "default" : "outline"}
              aria-pressed={rating === 0}
              onClick={() => change(setRating)(0)}
            >
              0★
            </Button>
            <Button
              type="button"
              size="sm"
              variant={rating === null ? "default" : "outline"}
              aria-pressed={rating === null}
              onClick={() => change(setRating)(null)}
            >
              No rating
            </Button>
          </div>
          <span className="text-muted-foreground text-sm" aria-live="polite">
            {rating === null ? "Not rated" : ratingLabel(rating)}
          </span>
        </div>
      </section>

      <section aria-label="Review text" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Editor mode" className="flex gap-1">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium capitalize",
                  tab === t ? "bg-muted" : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "write" && (
            <div
              className="flex flex-wrap items-center gap-0.5"
              role="toolbar"
              aria-label="Formatting"
            >
              <ToolButton label="Bold" onClick={wrap("**", "bold text")} icon={Bold} />
              <ToolButton label="Italic" onClick={wrap("*", "italic text")} icon={Italic} />
              <ToolButton label="Link" onClick={link} icon={Link2} />
              <ToolButton label="Quote" onClick={quote("quote")} icon={Quote} />
              <ToolButton label="Pull quote" onClick={quote("pull")} icon={TextQuote} />
              <ToolButton
                label={uploading ? "Uploading…" : "Add image"}
                onClick={() => fileInput.current?.click()}
                icon={ImagePlus}
                disabled={uploading}
              />
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadImage(file);
                }}
              />
              {tracks.length > 0 && (
                <label className="relative inline-flex">
                  <span className="sr-only">Insert a track with a play button</span>
                  <ListMusic
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
                    aria-hidden
                  />
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) insertTrack(Number(e.target.value));
                    }}
                    className="border-border bg-background h-8 w-32 appearance-none rounded-lg border pr-2 pl-8 text-xs"
                  >
                    <option value="">Insert track…</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.position}>
                        {t.position}. {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        {tab === "write" ? (
          <>
            <Textarea
              ref={textarea}
              value={body}
              onChange={(e) => change(setBody)(e.target.value)}
              maxLength={MAX_BODY}
              rows={16}
              aria-label="Review text"
              placeholder="Write as much as you like. Markdown works: **bold**, *italic*, > quotes, [links](https://example.com)."
              className="min-h-72 font-mono text-[0.9rem] leading-relaxed"
            />
            <p className="text-muted-foreground text-xs">
              {body.length.toLocaleString("en-US")} / {MAX_BODY.toLocaleString("en-US")} characters.
              Leave it empty to log just a rating.
            </p>
          </>
        ) : (
          <div className="border-border min-h-72 rounded-lg border p-4">
            {body.trim() ? (
              <ReviewBody markdown={body} tracks={tracks} imagePrefixes={imagePrefixes} />
            ) : (
              <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="favorite-heading" className="space-y-2">
        <h2 id="favorite-heading" className="text-sm font-medium">
          Favorite song
        </h2>
        {tracks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The track list is still loading. Reload in a moment to pick a favorite.
          </p>
        ) : (
          <select
            aria-label="Favorite song on this album"
            value={favoriteTrackId ?? ""}
            onChange={(e) => change(setFavoriteTrackId)(e.target.value || null)}
            className="border-border bg-background h-9 max-w-full rounded-lg border px-3 text-sm"
          >
            <option value="">No favorite</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <p className="text-muted-foreground text-xs">
          Shown at the end of your review. You can only pick a song from this album.
        </p>
      </section>

      <section aria-labelledby="clip-heading" className="space-y-2">
        <h2 id="clip-heading" className="text-sm font-medium">
          Song clip
        </h2>
        {tracks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            The track list is still loading. Reload in a moment to attach a clip.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Track for the song clip"
              value={clipTrackId ?? ""}
              onChange={(e) => change(setClipTrackId)(e.target.value || null)}
              className="border-border bg-background h-9 max-w-full rounded-lg border px-3 text-sm"
            >
              <option value="">No clip</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.position}. {t.title}
                </option>
              ))}
            </select>
            {clipTrack && (
              <ClipButton
                key={clipTrack.id}
                trackId={clipTrack.id}
                previewUrl={clipTrack.previewUrl}
                label={`Test: ${clipTrack.title}`}
              />
            )}
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          A 30-second preview plays on your review. Some tracks don&apos;t have one; use the test
          button to check.
        </p>
      </section>

      <section aria-labelledby="tags-heading" className="space-y-2">
        <h2 id="tags-heading" className="text-sm font-medium">
          Tags
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="bg-muted inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => change(setTags)(tags.filter((t) => t !== tag))}
                className="hover:bg-background rounded-full p-0.5"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          {tags.length < MAX_TAGS && (
            <Input
              value={tagDraft}
              maxLength={MAX_TAG_LENGTH}
              onChange={(e) => setTagDraft(e.target.value.replace(",", ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitTag(tagDraft);
                } else if (e.key === "Backspace" && !tagDraft && tags.length) {
                  change(setTags)(tags.slice(0, -1));
                }
              }}
              onBlur={() => tagDraft && commitTag(tagDraft)}
              placeholder="Add a tag, press Enter"
              aria-label="Add a tag"
              className="w-48"
            />
          )}
        </div>
      </section>

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={cn(
            "text-sm",
            message.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      )}

      <div className="bg-background/90 sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t px-4 py-3 backdrop-blur">
        <Button type="button" onClick={() => save("published")} disabled={pending || uploading}>
          {pending ? "Saving…" : published ? "Update review" : "Publish"}
        </Button>
        {!published ? (
          <Button type="button" variant="outline" onClick={() => save("draft")} disabled={pending}>
            Save draft
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => save("draft")} disabled={pending}>
            Unpublish
          </Button>
        )}
        <span className="flex-1" />
        {reviewId && (
          <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" />
    </Button>
  );
}
