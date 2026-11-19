ALTER TYPE "public"."queue_status" ADD VALUE 'suggested';--> statement-breakpoint
DROP INDEX "queue_items_owner_album_queued_key";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accept_suggestions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_items_owner_album_open_key" ON "queue_items" USING btree ("owner_id","album_id") WHERE "queue_items"."status" NOT IN ('reviewed', 'dismissed');