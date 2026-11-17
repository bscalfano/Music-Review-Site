import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewBody } from "@/components/review-body";
import { markdownExcerpt } from "@/lib/markdown/directives";

const TRACKS = [
  { id: "11111111-1111-4111-8111-111111111111", position: 1, title: "Airbag", previewUrl: null },
  {
    id: "22222222-2222-4222-8222-222222222222",
    position: 3,
    title: "Subterranean",
    previewUrl: null,
  },
];
const IMG_PREFIX = "https://cdn.example.com/review-images/";

const render = (markdown: string) =>
  renderToStaticMarkup(
    <ReviewBody markdown={markdown} tracks={TRACKS} imagePrefixes={[IMG_PREFIX]} />,
  );

describe("review markdown: untrusted input renders safely", () => {
  it("never produces a <script> element, and shows raw HTML as inert text", () => {
    const html = render('Hello <script>alert(1)</script> world\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toMatch(/<img[^>]*src="x"/);
  });

  it("drops dangerous link protocols but keeps the link text", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      const html = render(`[click me](${href})`);
      expect(html, href).toContain("click me");
      expect(html, href).not.toMatch(/href="(javascript|data|vbscript):/i);
    }
  });

  it("opens ordinary links safely in a new tab", () => {
    const html = render("[site](https://example.com/a)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).toMatch(/rel="[^"]*nofollow[^"]*"/);
  });

  it("only shows images from our own upload storage", () => {
    const own = render(`![cover](${IMG_PREFIX}u/abc.webp)`);
    expect(own).toContain(`<img src="${IMG_PREFIX}u/abc.webp"`);

    const foreign = render("![tracker](https://evil.example/pixel.gif)");
    expect(foreign).not.toContain("<img");
    expect(foreign).not.toContain("evil.example");

    const dataUri = render("![x](data:image/svg+xml;base64,PHN2Zz4=)");
    expect(dataUri).not.toContain("<img");
  });

  it("demotes h1 so the page keeps a single h1", () => {
    const html = render("# Big\n\n## Medium");
    expect(html).not.toContain("<h1");
    expect(html).toContain("<h2");
  });

  it("does not let authors inject classes or ids", () => {
    const html = render("> quote\n\n[a](https://example.com){.fixed .inset-0}");
    expect(html).not.toContain("fixed inset-0");
  });
});

describe("review markdown: directives", () => {
  it("renders :::pullquote as a highlighted blockquote", () => {
    const html = render(":::pullquote\nThe drums alone are worth it.\n:::");
    expect(html).toContain("<blockquote");
    expect(html).toContain("The drums alone are worth it.");
    expect(html).toContain("italic");
  });

  it("renders ::track{n=3} as a play button for that track", () => {
    const html = render("Best moment:\n\n::track{n=3}");
    expect(html).toContain("<button");
    expect(html).toContain("Subterranean");
    expect(html).toContain("Play clip of 3. Subterranean");
  });

  it("works inline with :track{n=1}", () => {
    const html = render("Start with :track{n=1} and go from there.");
    expect(html).toContain("Airbag");
    expect(html).toContain("Start with");
    expect(html).toContain("and go from there.");
  });

  it("shows a harmless placeholder for a track that isn't on the album", () => {
    const html = render("::track{n=40}");
    expect(html).toContain("[track 40]");
    expect(html).not.toContain("<button");
  });

  it("turns unknown or malformed directives back into the text that was typed", () => {
    expect(render("Listen to Re:Stacks tonight")).toContain("Re:Stacks");
    expect(render("Doors at 12:30 sharp")).toContain("12:30");
    expect(render("::track{n=abc}")).toContain("::track");
    expect(render("::youtube{id=abc}")).toContain("::youtube");
    const container = render(":::iframe{src=https://evil.example}\nbody text\n:::");
    expect(container).not.toContain("<iframe");
    expect(container).not.toContain("evil.example");
    expect(container).toContain("body text");
  });

  it("does not let a directive smuggle in attributes", () => {
    const html = render(':::pullquote{onclick="alert(1)" class="fixed inset-0"}\ntext\n:::');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("fixed inset-0");
  });
});

describe("markdownExcerpt", () => {
  it("returns plain text without markdown syntax", () => {
    expect(markdownExcerpt("# Title\n\nSome **bold** and [a link](https://x.com) here.")).toBe(
      "Title Some bold and a link here.",
    );
  });

  it("drops images, directives and track markers", () => {
    const text = markdownExcerpt(
      ":::pullquote\nQuote\n:::\n\n![alt](https://cdn/x.webp)\n\nSee ::track{n=2} now",
    );
    expect(text).toBe("Quote See now");
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const text = markdownExcerpt("word ".repeat(100), 50);
    expect(text.length).toBeLessThanOrEqual(51);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/wor…$/);
  });

  it("leaves short text alone", () => {
    expect(markdownExcerpt("Short and sweet.")).toBe("Short and sweet.");
  });
});
