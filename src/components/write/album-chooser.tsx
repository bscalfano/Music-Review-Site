"use client";

import { useRouter } from "next/navigation";
import { AlbumPicker } from "@/components/album-picker";

/** Step one of /write: pick the album, then continue to the editor. */
export function AlbumChooser() {
  const router = useRouter();
  return <AlbumPicker autoFocus onPick={(album) => router.push(`/write?album=${album.mbid}`)} />;
}
