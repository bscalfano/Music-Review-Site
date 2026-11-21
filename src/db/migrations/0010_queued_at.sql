ALTER TABLE "queue_items" ADD COLUMN "queued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "queue_items" SET "queued_at" = "created_at";