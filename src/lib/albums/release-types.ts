/** How the artist page groups a discography, in the order the sections are shown. */
export const RELEASE_CATEGORIES = [
  "Albums",
  "EPs",
  "Singles",
  "Live",
  "Compilations",
  "Soundtracks",
  "Remixes",
  "Other",
] as const;
export type ReleaseCategory = (typeof RELEASE_CATEGORIES)[number];

/**
 * MusicBrainz gives each release group one primary type (Album, EP, Single, Broadcast, Other)
 * and any number of secondary types (Live, Compilation, ...). A secondary type wins, so a live
 * album sits under "Live" rather than "Albums".
 */
export function releaseCategory(
  primaryType: string | null,
  secondaryTypes: readonly string[] = [],
): ReleaseCategory {
  if (secondaryTypes.includes("Live")) return "Live";
  if (secondaryTypes.includes("Compilation")) return "Compilations";
  if (secondaryTypes.includes("Soundtrack")) return "Soundtracks";
  if (secondaryTypes.includes("Remix")) return "Remixes";
  if (secondaryTypes.length > 0) return "Other"; // demos, mixtapes, DJ-mixes, spoken word, ...
  if (primaryType === "Album") return "Albums";
  if (primaryType === "EP") return "EPs";
  if (primaryType === "Single") return "Singles";
  return "Other";
}
