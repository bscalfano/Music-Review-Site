CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"caption" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"image_path" text,
	"title" text,
	"body" text DEFAULT '' NOT NULL,
	"rating" smallint,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"album_mbid" uuid,
	"matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_rating_range" CHECK ("import_items"."rating" IS NULL OR "import_items"."rating" BETWEEN 0 AND 10),
	CONSTRAINT "import_items_status" CHECK ("import_items"."status" IN ('pending', 'skipped', 'imported'))
);
--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_owner_source_key" ON "import_items" USING btree ("owner_id","source_key");--> statement-breakpoint
CREATE INDEX "import_items_owner_status_idx" ON "import_items" USING btree ("owner_id","status","posted_at");