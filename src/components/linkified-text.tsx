import Link from "next/link";
import type { ReactNode } from "react";

const TOKEN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]|@[a-z0-9_]{3,20}\b)/gi;

/**
 * Plain text with line breaks, URLs and @mentions turned into links. Rendered as React nodes
 * (never as HTML), so user text can't inject markup. External links are marked nofollow/ugc.
 */
export function LinkifiedText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    nodes.push(
      token.startsWith("@") ? (
        <Link
          key={index}
          href={`/u/${token.slice(1).toLowerCase()}`}
          className="text-(--profile-accent,inherit) underline underline-offset-2"
        >
          {token}
        </Link>
      ) : (
        <a
          key={index}
          href={token}
          target="_blank"
          rel="nofollow ugc noopener noreferrer"
          className="text-(--profile-accent,inherit) underline underline-offset-2"
        >
          {token}
        </a>
      ),
    );
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <span className="whitespace-pre-line">{nodes}</span>;
}
