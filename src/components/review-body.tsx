import Markdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import { ClipButton } from "@/components/clip-button";
import { remarkReviewDirectives } from "@/lib/markdown/directives";

export type BodyTrack = {
  id: string;
  position: number;
  title: string;
  /** Only when the server knows the stored clip URL is still valid. */
  previewUrl: string | null;
};

/**
 * Sanitization is the safety net for everything strangers write. Raw HTML in the markdown is
 * never parsed (react-markdown shows it as text), and on top of that this schema only keeps
 * ordinary markdown output plus our two custom hooks: `blockquote.pullquote` and `span[data-track]`.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [["className", "pullquote"]],
    span: ["dataTrack"],
  },
};

const SAFE_PROTOCOL = /^(https?:|mailto:|\/(?!\/)|#)/i;

export function ReviewBody({
  markdown,
  tracks = [],
  imagePrefixes = [],
}: {
  markdown: string;
  tracks?: BodyTrack[];
  /** Image URLs must start with one of these (our own upload storage). */
  imagePrefixes?: string[];
}) {
  const components: Components = {
    a({ href, children }) {
      if (!href || !SAFE_PROTOCOL.test(href)) return <>{children}</>;
      const external = /^https?:/i.test(href);
      return (
        <a
          href={href}
          {...(external ? { target: "_blank", rel: "nofollow noopener noreferrer ugc" } : {})}
          className="underline underline-offset-2"
        >
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      const url = typeof src === "string" ? src : "";
      if (!url || !imagePrefixes.some((p) => url.startsWith(p))) {
        // Only images uploaded through our editor are shown; anything else is just its alt text.
        return alt ? <span className="text-muted-foreground italic">[image: {alt}]</span> : null;
      }
      return (
        // eslint-disable-next-line @next/next/no-img-element -- user uploads, already resized
        <img src={url} alt={alt ?? ""} loading="lazy" className="my-4 max-h-[32rem] rounded-lg" />
      );
    },
    // The page title is the h1; keep the review's own headings below it.
    h1: ({ children }) => <h2 className="mt-6 mb-2 text-xl font-bold">{children}</h2>,
    h2: ({ children }) => <h2 className="mt-6 mb-2 text-xl font-bold">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-5 mb-2 text-lg font-semibold">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-4 mb-1 font-semibold">{children}</h4>,
    h5: ({ children }) => <h4 className="mt-4 mb-1 font-semibold">{children}</h4>,
    h6: ({ children }) => <h4 className="mt-4 mb-1 font-semibold">{children}</h4>,
    blockquote({ children, ...props }) {
      const pull = String((props as { className?: string }).className ?? "").includes("pullquote");
      return pull ? (
        <blockquote className="my-6 border-l-4 border-(--profile-accent,var(--primary)) pl-4 text-xl leading-snug font-medium italic">
          {children}
        </blockquote>
      ) : (
        <blockquote className="border-border text-muted-foreground my-4 border-l-2 pl-4">
          {children}
        </blockquote>
      );
    },
    span(props) {
      const raw = (props as Record<string, unknown>)["data-track"];
      if (typeof raw !== "string") return <span>{props.children}</span>;
      const position = Number(raw);
      const track = tracks.find((t) => t.position === position);
      if (!track) {
        return <span className="text-muted-foreground">[track {raw}]</span>;
      }
      return (
        <ClipButton
          trackId={track.id}
          previewUrl={track.previewUrl}
          label={`${track.position}. ${track.title}`}
          className="mx-0.5 align-middle"
        />
      );
    },
    ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
    ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
    p: ({ children }) => <p className="my-3">{children}</p>,
    hr: () => <hr className="my-6" />,
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b px-2 py-1 text-left">{children}</th>,
    td: ({ children }) => <td className="border-b px-2 py-1">{children}</td>,
    code: ({ children }) => (
      <code className="bg-muted rounded px-1 py-0.5 text-[0.9em]">{children}</code>
    ),
  };

  return (
    <div className="review-body leading-relaxed break-words">
      <Markdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkReviewDirectives]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
        // react-markdown ignores raw HTML by default; this also keeps URL checking on.
      >
        {markdown}
      </Markdown>
    </div>
  );
}
