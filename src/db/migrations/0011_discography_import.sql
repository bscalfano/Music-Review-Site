ALTER TABLE "albums" ADD COLUMN "secondary_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "discography_imported_at" timestamp with time zone;