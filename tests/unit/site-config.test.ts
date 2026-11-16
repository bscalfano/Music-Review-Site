import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteConfig } from "@/config/site";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("site config", () => {
  it("has a name", () => {
    expect(siteConfig.name.length).toBeGreaterThan(0);
  });

  it("keeps the working name only in src/config/site.ts", () => {
    const offenders = walk("src")
      .filter((f) => /\.(ts|tsx|css|md|json)$/.test(f))
      .filter((f) => !f.endsWith(join("src", "config", "site.ts")))
      .filter((f) => readFileSync(f, "utf8").includes("Distortion"));
    expect(offenders).toEqual([]);
  });
});
