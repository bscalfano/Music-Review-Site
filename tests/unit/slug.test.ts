import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it.each([
    ["Kid A", "kid-a"],
    ["Beyoncé — Lemonade", "beyonce-lemonade"],
    ["Sigur Rós", "sigur-ros"],
    ["Guns N' Roses", "guns-n-roses"],
    ["Mumford & Sons", "mumford-and-sons"],
    ["  --Weird__Name!!  ", "weird-name"],
    ["!!!", "untitled"],
    ["", "untitled"],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugify("a".repeat(10) + " " + "b".repeat(10), 11);
    expect(slug).toBe("aaaaaaaaaa");
  });
});
