CREATE TABLE "client_errors" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"route" text,
	"component" text,
	"app_version" text NOT NULL,
	"platform" text NOT NULL,
	"frames" jsonb DEFAULT '[]' NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_errors_platform_check" CHECK (platform in ('ios', 'android', 'web'))
);
--> statement-breakpoint
CREATE INDEX "client_errors_created" ON "client_errors" ("created_at");