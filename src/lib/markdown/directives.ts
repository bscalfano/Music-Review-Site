import { visit, SKIP } from "unist-util-visit";

/**
 * The only "rich" syntax reviews get beyond plain markdown. Reviews are written by strangers, so
 * this is a closed list rendered as fixed React components (no MDX, no raw HTML):
 *
 *   :::pullquote            a highlighted quote (container)
 *   Some text
 *   :::
 *
 *   ::track{n=3}            a play button for track 3 of the album (own line)
 *   :track{n=3}             the same, inline in a sentence
 *
 * Any other directive is turned back into the text the author typed, so things like "Re:Stacks"
 * or "12:30" are not swallowed.
 */

type Node = {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: Node[];
  value?: string;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

export const MAX_TRACK_NUMBER = 99;

function parseTrackNumber(attributes: Node["attributes"]): number | null {
  const raw = attributes?.n;
  if (typeof raw !== "string" || !/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_TRACK_NUMBER ? n : null;
}

const text = (value: string): Node => ({ type: "text", value });

export function remarkReviewDirectives() {
  return (tree: Node) => {
    visit(tree as never, (rawNode, index, rawParent) => {
      const node = rawNode as Node;
      const parent = rawParent as Node | undefined;
      if (
        node.type !== "textDirective" &&
        node.type !== "leafDirective" &&
        node.type !== "containerDirective"
      ) {
        return;
      }
      const name = node.name ?? "";

      if (node.type === "containerDirective" && name === "pullquote") {
        node.data = { hName: "blockquote", hProperties: { className: ["pullquote"] } };
        return;
      }

      if (name === "track" && node.type !== "containerDirective") {
        const n = parseTrackNumber(node.attributes);
        if (n !== null) {
          node.children = [];
          node.data = { hName: "span", hProperties: { dataTrack: String(n) } };
          return;
        }
      }

      // Unknown or malformed: show what was typed instead of dropping it.
      if (!parent?.children || index === undefined) return;
      let replacement: Node[];
      if (node.type === "textDirective") {
        replacement = [text(`:${name}`), ...(node.children ?? [])];
      } else if (node.type === "leafDirective") {
        replacement = [{ type: "paragraph", children: [text(`::${name}`)] }];
      } else {
        replacement = node.children ?? [];
      }
      parent.children.splice(index, 1, ...replacement);
      return [SKIP, index];
    });
  };
}

/** Plain text preview of a markdown body, for cards, meta descriptions and share images. */
export function markdownExcerpt(markdown: string, maxLength = 280): string {
  const plain = markdown
    .replace(/^:::.*$/gm, " ") // container directive fences
    .replace(/::?track\{[^}]*\}/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "") // headings, quotes, list markers
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}
