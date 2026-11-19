ALTER TABLE "lists" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "favorite_track_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_favorite_track_id_tracks_id_fk" FOREIGN KEY ("favorite_track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "lists" SET "published_at" = "created_at" WHERE "status" = 'published';