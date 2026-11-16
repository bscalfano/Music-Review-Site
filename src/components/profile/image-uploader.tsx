"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { updateBannerFocal } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Pick, crop and upload an avatar (square) or banner (2:1). The browser only chooses the crop
 * rectangle; the server re-encodes the image, which strips location data and animation.
 */
export function ImageUploader({
  kind,
  currentUrl,
  focalY = 50,
  uploadsEnabled,
}: {
  kind: "avatar" | "banner";
  currentUrl: string | null;
  focalY?: number;
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [focal, setFocal] = useState(focalY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const isAvatar = kind === "avatar";

  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src],
  );

  const choose = (f: File | undefined) => {
    setError(undefined);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("Image must be under 4 MB.");
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setError("Use a JPEG, PNG or WebP image.");
    setFile(f);
    setSrc(URL.createObjectURL(f));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const cancel = () => {
    setFile(null);
    setSrc(null);
    setError(undefined);
  };

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  const upload = async () => {
    if (!file || !area) return;
    setBusy(true);
    setError(undefined);
    const body = new FormData();
    body.set("file", file);
    body.set("crop", JSON.stringify(area));
    body.set("focalY", String(focal));
    try {
      const res = await fetch(`/api/upload/${kind}`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      cancel();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    await fetch(`/api/upload/${kind}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div
          className={`bg-muted relative shrink-0 overflow-hidden ${isAvatar ? "size-20 rounded-full" : "aspect-[3/1] w-56 rounded-lg"}`}
        >
          {currentUrl && (
            <Image
              src={currentUrl}
              alt={isAvatar ? "Your avatar" : "Your banner"}
              fill
              sizes="224px"
              unoptimized
              className="object-cover"
              style={isAvatar ? undefined : { objectPosition: `50% ${focal}%` }}
            />
          )}
        </div>
        <div className="space-y-2">
          <label
            className={`${uploadsEnabled ? "cursor-pointer" : "pointer-events-none opacity-50"} hover:bg-muted inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium`}
          >
            {currentUrl ? "Replace" : "Upload"} {isAvatar ? "avatar" : "banner"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={!uploadsEnabled}
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {currentUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={busy}
              className="ml-2"
            >
              Remove
            </Button>
          )}
          <p className="text-muted-foreground text-xs">JPEG, PNG or WebP, up to 4 MB.</p>
          {!uploadsEnabled && (
            <p className="text-muted-foreground text-xs">File storage isn&apos;t configured yet.</p>
          )}
        </div>
      </div>

      {src && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="relative h-64 w-full overflow-hidden rounded bg-black">
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={isAvatar ? 1 : 2}
              cropShape={isAvatar ? "round" : "rect"}
              showGrid={!isAvatar}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <label className="flex items-center gap-3 text-sm">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
            />
          </label>
          {!isAvatar && <FocalSlider value={focal} onChange={setFocal} />}
          <div className="flex gap-2">
            <Button type="button" onClick={upload} disabled={busy || !area}>
              {busy ? "Uploading…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!src && !isAvatar && currentUrl && (
        <div className="space-y-2">
          <FocalSlider value={focal} onChange={setFocal} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending || focal === focalY}
            onClick={() =>
              startTransition(async () => {
                await updateBannerFocal(focal);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save position"}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function FocalSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0">
        Visible area on wide screens
        <span className="text-muted-foreground block text-xs">Top ↔ bottom</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        aria-label="Banner vertical position"
      />
    </label>
  );
}
