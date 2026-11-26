CREATE TABLE "people" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "people_source_key_key" UNIQUE,
	"slug" text NOT NULL CONSTRAINT "people_slug_key" UNIQUE,
	"name" text NOT NULL,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"suffix" text,
	"name_key" text GENERATED ALWAYS AS (os_name_key(first_name, last_name)) STORED,
	"party" text,
	"photo_key" text,
	"photo_credit" text,
	"photo_license" text,
	"photo_source_url" text,
	"photo_width" integer,
	"photo_height" integer,
	"photo_pending_key" text,
	"website" text,
	"donate_url" text,
	"volunteer_url" text,
	"pending_links" jsonb,
	"claimed_by" uuid,
	"origin" jsonb,
	"roster_only" boolean DEFAULT false NOT NULL,
	"overrides" jsonb DEFAULT '{}' NOT NULL,
	"merged_into" uuid,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("slug") <= 120),
	CONSTRAINT "people_party_check" CHECK ("party" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "people_website_check" CHECK ("website" like 'https://%'),
	CONSTRAINT "people_donate_url_check" CHECK ("donate_url" like 'https://%'),
	CONSTRAINT "people_volunteer_url_check" CHECK ("volunteer_url" like 'https://%'),
	CONSTRAINT "people_photo_source_url_check" CHECK ("photo_source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "person_aliases" (
	"person_id" uuid,
	"alias" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_aliases_pkey" PRIMARY KEY("person_id","alias")
);
--> statement-breakpoint
CREATE TABLE "given_name_aliases" (
	"canonical" text,
	"alias" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "given_name_aliases_pkey" PRIMARY KEY("canonical","alias"),
	CONSTRAINT "given_name_aliases_source_check" CHECK ("source" in ('nicknames', 'supplement', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "officeholders" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "officeholders_source_key_key" UNIQUE,
	"office_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"seat_label" text,
	"since" date,
	"until" date,
	"seat_up_next" boolean,
	"term_limited" boolean,
	"not_running" boolean,
	"cash_on_hand_cents" bigint,
	"cash_as_of" date,
	"cash_source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "officeholders_cash_source_url_check" CHECK ("cash_source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "candidacies" (
	"id" uuid PRIMARY KEY,
	"filing_key" text NOT NULL CONSTRAINT "candidacies_filing_key_key" UNIQUE,
	"source" text NOT NULL,
	"person_id" uuid NOT NULL,
	"election_id" uuid NOT NULL,
	"party" text,
	"status" text NOT NULL,
	"status_history" jsonb DEFAULT '[]' NOT NULL,
	"filed_on" date,
	"raw_name" text NOT NULL,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"suffix" text,
	"name_key" text GENERATED ALWAYS AS (os_name_key(first_name, last_name)) STORED,
	"source_url" text,
	"match_confidence" numeric,
	"overrides" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidacies_person_election_key" UNIQUE NULLS NOT DISTINCT("person_id","election_id","party"),
	CONSTRAINT "candidacies_status_check" CHECK ("status" in ('committee_registered', 'filed', 'qualified', 'on_ballot', 'advanced', 'withdrawn', 'disqualified', 'won', 'lost')),
	CONSTRAINT "candidacies_party_check" CHECK ("party" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "candidacies_match_confidence_check" CHECK ("match_confidence" between 0 and 1),
	CONSTRAINT "candidacies_source_url_check" CHECK ("source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "candidacy_filings" (
	"filing_key" text PRIMARY KEY,
	"candidacy_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"source_url" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidacy_filings_status_check" CHECK ("status" in ('committee_registered', 'filed', 'qualified', 'on_ballot', 'advanced', 'withdrawn', 'disqualified', 'won', 'lost')),
	CONSTRAINT "candidacy_filings_source_url_check" CHECK ("source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "unmatched_filings" (
	"id" uuid PRIMARY KEY,
	"filing_key" text NOT NULL CONSTRAINT "unmatched_filings_filing_key_key" UNIQUE,
	"kind" text DEFAULT 'filing' NOT NULL,
	"source" text NOT NULL,
	"state" char(2),
	"raw" jsonb NOT NULL,
	"reason" text,
	"suggested" jsonb,
	"features" jsonb,
	"resolution" text,
	"office_id" uuid,
	"person_id" uuid,
	"decided_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unmatched_filings_kind_check" CHECK ("kind" in ('filing', 'result')),
	CONSTRAINT "unmatched_filings_resolution_check" CHECK ("resolution" in ('matched', 'created', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX "people_name_trgm" ON "people" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_name_key_trgm" ON "people" USING gin ("name_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_last_name" ON "people" (lower("last_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "people_one_owner" ON "people" ("claimed_by") WHERE "claimed_by" is not null;--> statement-breakpoint
CREATE INDEX "people_photo_key" ON "people" ("photo_key") WHERE "photo_key" is not null;--> statement-breakpoint
CREATE INDEX "people_pending_links" ON "people" ("id") WHERE "pending_links" is not null;--> statement-breakpoint
CREATE INDEX "person_aliases_trgm" ON "person_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "given_name_aliases_alias" ON "given_name_aliases" ("alias");--> statement-breakpoint
CREATE INDEX "officeholders_office" ON "officeholders" ("office_id");--> statement-breakpoint
CREATE INDEX "officeholders_person" ON "officeholders" ("person_id");--> statement-breakpoint
CREATE INDEX "candidacies_election" ON "candidacies" ("election_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "candidacies_created" ON "candidacies" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "candidacy_filings_candidacy" ON "candidacy_filings" ("candidacy_id");--> statement-breakpoint
CREATE INDEX "candidacy_filings_source" ON "candidacy_filings" ("source") WHERE "gone_at" is null;--> statement-breakpoint
CREATE INDEX "unmatched_filings_open" ON "unmatched_filings" ("id") WHERE "resolved_at" is null;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_fkey" FOREIGN KEY ("merged_into") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "person_aliases" ADD CONSTRAINT "person_aliases_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "officeholders" ADD CONSTRAINT "officeholders_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "officeholders" ADD CONSTRAINT "officeholders_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "candidacy_filings" ADD CONSTRAINT "candidacy_filings_candidacy_id_fkey" FOREIGN KEY ("candidacy_id") REFERENCES "candidacies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "unmatched_filings" ADD CONSTRAINT "unmatched_filings_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id");--> statement-breakpoint
ALTER TABLE "unmatched_filings" ADD CONSTRAINT "unmatched_filings_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "unmatched_filings" ADD CONSTRAINT "unmatched_filings_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL;