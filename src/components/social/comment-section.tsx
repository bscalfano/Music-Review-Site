"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCommentAction, deleteCommentAction, editCommentAction } from "@/app/social/actions";
import { HeartButton } from "@/components/social/heart-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { AvatarView } from "@/components/avatar-view";
import type { CommentNode } from "@/lib/social/comments";

const MAX = 2000;

type Ctx = { reviewId: string; reviewPath: string; viewerId: string | null };

/** Comments and one level of replies under a review. */
export function CommentSection({
  reviewId,
  reviewPath,
  viewerId,
  comments,
  total,
}: Ctx & { comments: CommentNode[]; total: number }) {
  const ctx = { reviewId, reviewPath, viewerId };
  return (
    <section id="comments" aria-labelledby="comments-heading" className="mt-10 border-t pt-6">
      <h2 id="comments-heading" className="text-lg font-semibold">
        Comments {total > 0 && <span className="text-muted-foreground font-normal">{total}</span>}
      </h2>

      {viewerId ? (
        <div className="mt-4">
          <CommentForm
            {...ctx}
            parentId={null}
            placeholder="Add a comment…"
            submitLabel="Comment"
          />
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">
          <Link
            href={`/sign-in?callbackUrl=${encodeURIComponent(reviewPath)}`}
            className="underline"
          >
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}

      {comments.length > 0 ? (
        <ul className="mt-4 divide-y">
          {comments.map((c) => (
            <li key={c.id} className="py-4">
              <CommentItem comment={c} {...ctx} />
              {c.replies.length > 0 && (
                <ul className="border-border mt-3 ml-4 space-y-4 border-l pl-4 sm:ml-10">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      <CommentItem comment={r} {...ctx} isReply />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm">No comments yet.</p>
      )}
    </section>
  );
}

function CommentItem({
  comment: c,
  reviewId,
  reviewPath,
  viewerId,
  isReply = false,
}: Ctx & { comment: CommentNode; isReply?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "reply">("view");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  if (c.deleted || !c.author) {
    return (
      <p id={`comment-${c.id}`} className="text-muted-foreground text-sm italic">
        This comment was deleted.
      </p>
    );
  }

  function remove() {
    if (!confirm("Delete this comment?")) return;
    startTransition(async () => {
      const res = await deleteCommentAction(c.id, reviewPath);
      if (res.ok) router.refresh();
      else setError(res.message);
    });
  }

  const name = c.author.displayName ?? `@${c.author.handle}`;
  return (
    <article id={`comment-${c.id}`} className="flex scroll-mt-20 gap-3">
      <Link href={`/u/${c.author.handle}`} className="shrink-0" aria-label={`${name}'s profile`}>
        <AvatarView
          src={c.author.avatar}
          name={c.author.displayName ?? c.author.handle}
          size={isReply ? 28 : 36}
        />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Link href={`/u/${c.author.handle}`} className="font-semibold hover:underline">
            {name}
          </Link>
          <time dateTime={c.createdAt.toISOString()} className="text-muted-foreground text-xs">
            {c.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
          </time>
          {c.editedAt && <span className="text-muted-foreground text-xs">(edited)</span>}
        </p>

        {mode === "edit" ? (
          <CommentForm
            reviewId={reviewId}
            reviewPath={reviewPath}
            viewerId={viewerId}
            editing={{ id: c.id, body: c.body }}
            parentId={null}
            submitLabel="Save"
            onDone={() => setMode("view")}
          />
        ) : (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{c.body}</p>
        )}

        <div className="flex flex-wrap items-center gap-1 text-xs">
          <HeartButton
            targetType="comment"
            targetId={c.id}
            count={c.hearts}
            hearted={c.hearted}
            label={`comment by ${name}`}
            signInHref={
              viewerId ? undefined : `/sign-in?callbackUrl=${encodeURIComponent(reviewPath)}`
            }
          />
          {viewerId && !isReply && (
            <button
              type="button"
              onClick={() => setMode(mode === "reply" ? "view" : "reply")}
              className="text-muted-foreground hover:text-foreground rounded-full px-2 py-1"
            >
              Reply
            </button>
          )}
          {c.canEdit && mode !== "edit" && (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="text-muted-foreground hover:text-foreground rounded-full px-2 py-1"
            >
              Edit
            </button>
          )}
          {c.canDelete && (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive rounded-full px-2 py-1"
            >
              Delete
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        {mode === "reply" && (
          <div className="pt-2">
            <CommentForm
              reviewId={reviewId}
              reviewPath={reviewPath}
              viewerId={viewerId}
              parentId={c.id}
              placeholder={`Reply to ${name}…`}
              submitLabel="Reply"
              autoFocus
              onDone={() => setMode("view")}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function CommentForm({
  reviewId,
  reviewPath,
  parentId,
  editing,
  placeholder,
  submitLabel,
  autoFocus,
  onDone,
}: Ctx & {
  parentId: string | null;
  editing?: { id: string; body: string };
  placeholder?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState(editing?.body ?? "");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const res = editing
        ? await editCommentAction(editing.id, body, reviewPath)
        : await addCommentAction(reviewId, body, parentId, reviewPath);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setBody("");
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX}
        rows={editing || parentId ? 2 : 3}
        placeholder={placeholder}
        aria-label={editing ? "Edit comment" : (placeholder ?? "Comment")}
        autoFocus={autoFocus}
        className="min-h-16"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || body.trim() === ""}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {(editing || parentId) && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        {error && (
          <span role="alert" className="text-destructive text-xs">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
