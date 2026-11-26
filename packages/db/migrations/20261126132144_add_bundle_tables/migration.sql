CREATE TABLE "data_bundles" (
	"id" uuid PRIMARY KEY,
	"version" text NOT NULL CONSTRAINT "data_bundles_version_key" UNIQUE,
	"kind" text DEFAULT 'full' NOT NULL,
	"status" text NOT NULL,
	"stats" jsonb,
	"loaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_bundles_kind_check" CHECK ("kind" in ('full', 'filings')),
	CONSTRAINT "data_bundles_status_check" CHECK ("status" in ('loading', 'loaded', 'rejected', 'held', 'reverted'))
);
--> statement-breakpoint
CREATE TABLE "bundle_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bundle_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bundle_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_key" jsonb NOT NULL,
	"op" text NOT NULL,
	"before" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bundle_changes_op_check" CHECK ("op" in ('insert', 'update', 'retire', 'delete'))
);
--> statement-breakpoint
CREATE INDEX "data_bundles_loaded" ON "data_bundles" ("kind","loaded_at" DESC) WHERE "status" = 'loaded';--> statement-breakpoint
CREATE INDEX "bundle_changes_bundle" ON "bundle_changes" ("bundle_id","table_name");--> statement-breakpoint
ALTER TABLE "bundle_changes" ADD CONSTRAINT "bundle_changes_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "data_bundles"("id") ON DELETE CASCADE;