CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL CONSTRAINT "uploads_key_key" UNIQUE,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"platform" text NOT NULL,
	"content_type" text NOT NULL,
	"max_bytes" bigint NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"bytes" bigint,
	"sha256" text,
	"consumed_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_kind_check" CHECK ("kind" in ('photo', 'video')),
	CONSTRAINT "uploads_purpose_check" CHECK ("purpose" in ('avatar', 'post', 'message', 'person_photo')),
	CONSTRAINT "uploads_platform_check" CHECK ("platform" in ('ios', 'android', 'web')),
	CONSTRAINT "uploads_content_type_check" CHECK ("content_type" in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')),
	CONSTRAINT "uploads_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "uploads_user" ON "uploads" ("user_id","id");--> statement-breakpoint
CREATE INDEX "uploads_unconsumed" ON "uploads" ("created_at") WHERE "consumed_at" is null and "object_deleted_at" is null;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;