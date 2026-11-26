CREATE TABLE "powers" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"search" tsvector,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "powers_id_check" CHECK ("id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "issue_powers" (
	"issue_id" text NOT NULL,
	"power_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_powers_pkey" PRIMARY KEY("issue_id","power_id")
);
--> statement-breakpoint
CREATE TABLE "office_types" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"illustration" text NOT NULL,
	"electorate" text DEFAULT 'public' NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_types_id_check" CHECK ("id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "office_types_level_check" CHECK ("level" in ('local', 'county', 'state', 'federal', 'special')),
	CONSTRAINT "office_types_electorate_check" CHECK ("electorate" in ('public', 'members', 'party'))
);
--> statement-breakpoint
CREATE INDEX "powers_search" ON "powers" USING gin ("search");--> statement-breakpoint
CREATE INDEX "issue_powers_power" ON "issue_powers" ("power_id","issue_id");--> statement-breakpoint
ALTER TABLE "issue_powers" ADD CONSTRAINT "issue_powers_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id");--> statement-breakpoint
ALTER TABLE "issue_powers" ADD CONSTRAINT "issue_powers_power_id_fkey" FOREIGN KEY ("power_id") REFERENCES "powers"("id");
