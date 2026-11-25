CREATE TABLE "issues" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"color_light" text NOT NULL,
	"color_dark" text NOT NULL,
	"icon" text NOT NULL,
	"sort" integer NOT NULL CONSTRAINT "issues_sort_key" UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_id_check" CHECK ("id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
