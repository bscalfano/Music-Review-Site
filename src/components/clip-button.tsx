"use client";

import { Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resolveClipAction } from "@/app/clips/actions";
import { cn } from "@/lib/utils";

/** Only one clip plays at a time, site-wide. */
let stopCurrent: (() => void) | null = null;

type Status = "idle" | "loading" | "playing" | "unavailable";

/**
 * Play/pause for a track's 30-second clip. `previewUrl` is passed only when the server knows it
 * is still valid; otherwise (or if playback fails because a signed URL expired) the URL is
 * looked up on demand.
 */
export function ClipButton({
  trackId,
  previewUrl,
  label,
  variant = "chip",
  className,
}: {
  trackId: string;
  previewUrl: string | null;
  /** Accessible name and visible text for the chip, e.g. the track title. */
  label: string;
  variant?: "chip" | "icon";
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef(previewUrl);
  const stopSelf = useRef<() => void>(() => {});

  useEffect(() => {
    urlRef.current = previewUrl;
  }, [previewUrl]);

  // Stop (and release) the audio if the button goes away mid-playback.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (stopCurrent === stopSelf.current) stopCurrent = null;
    };
  }, []);

  function reset() {
    audioRef.current?.pause();
    setStatus("idle");
    setProgress(0);
  }
  stopSelf.current = reset;

  async function play(retry = false): Promise<void> {
    let url = urlRef.current;
    if (!url || retry) {
      setStatus("loading");
      const res = await resolveClipAction(trackId, retry);
      url = res.url;
      urlRef.current = url;
    }
    if (!url) {
      setStatus("unavailable");
      return;
    }
    stopCurrent?.();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    });
    audio.addEventListener("ended", reset);
    audio.addEventListener("error", () => {
      // Probably an expired signed URL: look it up once more, then give up.
      if (!retry) void play(true);
      else setStatus("unavailable");
    });
    stopCurrent = reset;
    try {
      await audio.play();
      setStatus("playing");
    } catch {
      // A newer click superseded this one, or the browser blocked playback.
      if (audioRef.current === audio && !retry) setStatus("idle");
    }
  }

  function toggle() {
    if (status === "loading") return;
    if (status === "playing") {
      reset();
      return;
    }
    void play();
  }

  const Icon = status === "loading" ? Loader2 : status === "playing" ? Pause : Play;
  const unavailable = status === "unavailable";
  const title = unavailable ? "No clip available for this track" : undefined;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={unavailable}
        aria-label={`${status === "playing" ? "Pause" : "Play clip of"} ${label}`}
        title={title}
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-40",
          className,
        )}
      >
        <Icon className={cn("size-4", status === "loading" && "animate-spin")} aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={unavailable}
      aria-label={`${status === "playing" ? "Pause" : "Play clip of"} ${label}`}
      title={title}
      className={cn(
        "bg-muted hover:bg-muted/70 focus-visible:ring-ring relative inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-full px-3 py-1 text-sm font-medium outline-none focus-visible:ring-2 disabled:opacity-60",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-(--profile-accent,var(--primary))/20"
        style={{ width: `${progress * 100}%` }}
      />
      <Icon
        className={cn("relative size-3.5 shrink-0", status === "loading" && "animate-spin")}
        aria-hidden
      />
      <span className="relative truncate">{unavailable ? `${label} (no clip)` : label}</span>
    </button>
  );
}
