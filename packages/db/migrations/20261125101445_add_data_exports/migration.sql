CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"object_key" text,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_exports_status_check" CHECK ("status" in ('queued', 'ready', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE INDEX "data_exports_user" ON "data_exports" ("user_id","id" DESC);--> statement-breakpoint
CREATE INDEX "data_exports_ready" ON "data_exports" ("ready_at") WHERE "status" = 'ready';--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;