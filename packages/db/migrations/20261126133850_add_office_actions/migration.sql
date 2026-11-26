CREATE TABLE "user_districts" (
	"user_id" uuid NOT NULL,
	"district_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_districts_pkey" PRIMARY KEY("user_id","district_id")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_pkey" PRIMARY KEY("follower_id","target_type","target_id"),
	CONSTRAINT "follows_target_type_check" CHECK ("target_type" in ('user', 'person', 'office')),
	CONSTRAINT "follows_not_self_check" CHECK ("target_type" <> 'user' or "target_id" <> "follower_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"office_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_pkey" PRIMARY KEY("user_id","office_id")
);
--> statement-breakpoint
CREATE TABLE "field_reports" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid,
	"office_id" uuid NOT NULL,
	"field" text,
	"message" text,
	"source_url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"exported_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_reports_status_check" CHECK ("status" in ('open', 'fixed', 'rejected')),
	CONSTRAINT "field_reports_source_url_check" CHECK ("source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_districts_district" ON "user_districts" ("district_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user" ON "bookmarks" ("user_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "bookmarks_office" ON "bookmarks" ("office_id");--> statement-breakpoint
CREATE INDEX "field_reports_queue" ON "field_reports" ("id") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "field_reports_office" ON "field_reports" ("office_id");--> statement-breakpoint
CREATE INDEX "field_reports_user" ON "field_reports" ("user_id","id");--> statement-breakpoint
CREATE INDEX "field_reports_decided" ON "field_reports" ("decided_at") WHERE "decided_at" is not null;--> statement-breakpoint
CREATE INDEX "follows_target" ON "follows" ("target_type","target_id","created_at" DESC,"follower_id");--> statement-breakpoint
CREATE INDEX "follows_follower" ON "follows" ("follower_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "admin_actions_admin" ON "admin_actions" ("admin_id","id" DESC);--> statement-breakpoint
CREATE INDEX "admin_actions_target" ON "admin_actions" (("target" ->> 'type'),("target" ->> 'id'));--> statement-breakpoint
ALTER TABLE "user_districts" ADD CONSTRAINT "user_districts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_districts" ADD CONSTRAINT "user_districts_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "field_reports" ADD CONSTRAINT "field_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "field_reports" ADD CONSTRAINT "field_reports_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "field_reports" ADD CONSTRAINT "field_reports_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE;