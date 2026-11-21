-- The favorite song is now also the preview. Keep existing clips where there is no favorite yet.
UPDATE "reviews" SET "favorite_track_id" = "clip_track_id" WHERE "favorite_track_id" IS NULL AND "clip_track_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_clip_track_id_tracks_id_fk";
--> statement-breakpoint
ALTER TABLE "reviews" DROP COLUMN "clip_track_id";