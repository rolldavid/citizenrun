CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "offices_source_key_key" UNIQUE,
	"slug" text NOT NULL CONSTRAINT "offices_slug_key" UNIQUE,
	"tile_id" bigint CONSTRAINT "offices_tile_id_key" UNIQUE GENERATED ALWAYS AS IDENTITY (sequence name "offices_tile_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9007199254740991 START WITH 1 CACHE 1),
	"jurisdiction_id" uuid NOT NULL,
	"district_id" uuid NOT NULL,
	"office_type_id" text NOT NULL,
	"state" char(2) NOT NULL,
	"title" text NOT NULL,
	"placeholder" boolean DEFAULT false NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"body_size" integer,
	"seats_up_next" integer,
	"vacant_seats_up_next" integer,
	"term_years" numeric,
	"term_limit_terms" integer,
	"partisan" boolean,
	"party_selection" text,
	"electorate" integer,
	"pay_annual_cents" bigint,
	"pay_kind" text,
	"pay_amount_cents" bigint,
	"pay_period" text,
	"pay_change_note" text,
	"benefits" text[],
	"hours_per_week" numeric,
	"full_time" boolean,
	"meeting_times" text[],
	"fits_day_job" text,
	"filing_fee_cents" bigint,
	"signatures_required" integer,
	"where_to_file" text,
	"eligibility" jsonb,
	"scale" numeric,
	"pivot" numeric,
	"term_factor" numeric,
	"ease" numeric,
	"ease_inputs" jsonb,
	"ease_confidence" text,
	"entrenched" boolean,
	"decided_in" text,
	"votes_to_win" integer,
	"votes_low" integer,
	"votes_high" integer,
	"votes_estimated" boolean,
	"effort" jsonb,
	"rank_base" numeric,
	"next_election_id" uuid,
	"next_filing_deadline" date,
	"completeness" text,
	"field_meta" jsonb DEFAULT '{}' NOT NULL,
	"overrides" jsonb DEFAULT '{}' NOT NULL,
	"search" tsvector,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offices_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("slug") <= 120),
	CONSTRAINT "offices_state_check" CHECK ("state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "offices_seats_check" CHECK ("seats" >= 1),
	CONSTRAINT "offices_seats_up_next_check" CHECK ("seats_up_next" <= "body_size"),
	CONSTRAINT "offices_vacant_seats_up_next_check" CHECK ("vacant_seats_up_next" >= 0 and "vacant_seats_up_next" <= "seats_up_next"),
	CONSTRAINT "offices_party_selection_check" CHECK ("party_selection" in ('primary_ballot', 'caucus', 'party_meeting')),
	CONSTRAINT "offices_pay_kind_check" CHECK ("pay_kind" in ('salary', 'stipend', 'per_meeting', 'none')),
	CONSTRAINT "offices_pay_period_check" CHECK ("pay_period" in ('year', 'month', 'meeting')),
	CONSTRAINT "offices_benefits_check" CHECK ("benefits" <@ array['health', 'retirement', 'other']::text[]),
	CONSTRAINT "offices_meeting_times_check" CHECK ("meeting_times" <@ array['daytime', 'evenings', 'weekends']::text[]),
	CONSTRAINT "offices_fits_day_job_check" CHECK ("fits_day_job" in ('yes', 'likely', 'no')),
	CONSTRAINT "offices_ease_check" CHECK ("ease" between 0 and 100),
	CONSTRAINT "offices_ease_confidence_check" CHECK ("ease_confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "offices_decided_in_check" CHECK ("decided_in" in ('primary', 'general')),
	CONSTRAINT "offices_completeness_check" CHECK ("completeness" in ('complete', 'partial', 'minimal'))
);
--> statement-breakpoint
CREATE TABLE "office_powers" (
	"office_id" uuid,
	"power_id" text,
	"relevance" smallint NOT NULL,
	"quote" text,
	"source_url" text,
	"confidence" text NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_powers_pkey" PRIMARY KEY("office_id","power_id"),
	CONSTRAINT "office_powers_relevance_check" CHECK ("relevance" between 1 and 3),
	CONSTRAINT "office_powers_confidence_check" CHECK ("confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "office_powers_source_url_check" CHECK ("source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "office_issues" (
	"office_id" uuid,
	"issue_id" text,
	"relevance" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_issues_pkey" PRIMARY KEY("office_id","issue_id"),
	CONSTRAINT "office_issues_relevance_check" CHECK ("relevance" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "elections_source_key_key" UNIQUE,
	"office_id" uuid NOT NULL,
	"election_date" date NOT NULL,
	"kind" text NOT NULL,
	"party" text,
	"filing_opens" date,
	"filing_deadline" date,
	"filing_deadline_time" time,
	"petition_due" date,
	"deadline_basis" text,
	"deadline_conflict" jsonb,
	"turnout_class" text NOT NULL,
	"field_meta" jsonb DEFAULT '{}' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elections_contest_key" UNIQUE NULLS NOT DISTINCT("office_id","election_date","kind","party"),
	CONSTRAINT "elections_kind_check" CHECK ("kind" in ('primary', 'general', 'primary_runoff', 'general_runoff', 'special')),
	CONSTRAINT "elections_party_check" CHECK ("party" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "elections_deadline_basis_check" CHECK ("deadline_basis" in ('computed', 'scraped', 'both')),
	CONSTRAINT "elections_turnout_class_check" CHECK ("turnout_class" in ('presidential_general', 'midterm_general', 'odd_year_general', 'primary', 'standalone_local', 'odd_year_statewide', 'spring_local', 'spring_with_presidential_primary', 'runoff')),
	CONSTRAINT "elections_filing_window_check" CHECK ("filing_opens" <= "filing_deadline"),
	CONSTRAINT "elections_filing_deadline_check" CHECK ("filing_deadline" <= "election_date")
);
--> statement-breakpoint
CREATE TABLE "filing_tracks" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "filing_tracks_source_key_key" UNIQUE,
	"election_id" uuid NOT NULL,
	"track" text NOT NULL,
	"opens_on" date,
	"closes_on" date,
	"closes_time" time,
	"petition_opens" date,
	"petition_due" date,
	"fee_cents" bigint,
	"signatures" integer,
	"where_to_file" text,
	"basis" text NOT NULL,
	"source_url" text,
	"quote" text,
	"rule_citation" text,
	"confidence" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"field_meta" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_tracks_track_key" UNIQUE("election_id","track"),
	CONSTRAINT "filing_tracks_track_check" CHECK ("track" in ('party_primary', 'independent', 'nonpartisan', 'write_in', 'incumbent')),
	CONSTRAINT "filing_tracks_basis_check" CHECK ("basis" in ('computed', 'scraped', 'both')),
	CONSTRAINT "filing_tracks_confidence_check" CHECK ("confidence" in ('high', 'medium', 'low')),
	CONSTRAINT "filing_tracks_window_check" CHECK ("opens_on" <= "closes_on"),
	CONSTRAINT "filing_tracks_source_url_check" CHECK ("source_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "results_source_key_key" UNIQUE,
	"office_id" uuid NOT NULL,
	"election_id" uuid,
	"election_date" date NOT NULL,
	"kind" text NOT NULL,
	"party" text,
	"turnout_class" text NOT NULL,
	"total_votes" integer,
	"winner_votes" integer,
	"margin_votes" integer,
	"contested" boolean,
	"candidates" jsonb,
	"certified" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_contest_key" UNIQUE NULLS NOT DISTINCT("office_id","election_date","kind","party"),
	CONSTRAINT "results_kind_check" CHECK ("kind" in ('primary', 'general', 'primary_runoff', 'general_runoff', 'special')),
	CONSTRAINT "results_turnout_class_check" CHECK ("turnout_class" in ('presidential_general', 'midterm_general', 'odd_year_general', 'primary', 'standalone_local', 'odd_year_statewide', 'spring_local', 'spring_with_presidential_primary', 'runoff')),
	CONSTRAINT "results_party_check" CHECK ("party" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "results_source_url_check" CHECK ("source_url" like 'https://%')
);
--> statement-breakpoint
CREATE INDEX "offices_search" ON "offices" USING gin ("search");--> statement-breakpoint
CREATE INDEX "offices_title_trgm" ON "offices" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "offices_district" ON "offices" ("district_id");--> statement-breakpoint
CREATE INDEX "offices_jurisdiction" ON "offices" ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "offices_office_type" ON "offices" ("office_type_id");--> statement-breakpoint
CREATE INDEX "offices_state_rank" ON "offices" ("state","rank_base" DESC NULLS LAST,"id") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "offices_state_spt" ON "offices" ("state",("scale" * "pivot" * "term_factor") desc nulls last,"id") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "offices_state_ease" ON "offices" ("state","ease" DESC NULLS LAST,"id") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "offices_state_pay" ON "offices" ("state","pay_annual_cents" DESC NULLS LAST,"id") WHERE "retired_at" is null;--> statement-breakpoint
CREATE INDEX "offices_state_deadline" ON "offices" ("state","next_filing_deadline","id") WHERE "retired_at" is null and "next_filing_deadline" is not null;--> statement-breakpoint
CREATE INDEX "office_powers_power" ON "office_powers" ("power_id","relevance" DESC);--> statement-breakpoint
CREATE INDEX "office_issues_issue" ON "office_issues" ("issue_id","relevance" DESC);--> statement-breakpoint
CREATE INDEX "elections_deadline" ON "elections" ("filing_deadline");--> statement-breakpoint
CREATE INDEX "elections_date" ON "elections" ("election_date");--> statement-breakpoint
CREATE INDEX "elections_opens" ON "elections" ("filing_opens") WHERE "filing_opens" is not null;--> statement-breakpoint
CREATE INDEX "filing_tracks_closes" ON "filing_tracks" ("closes_on") WHERE "closes_on" is not null;--> statement-breakpoint
CREATE INDEX "results_date" ON "results" ("election_date" DESC);--> statement-breakpoint
CREATE INDEX "results_election" ON "results" ("election_id") WHERE "election_id" is not null;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id");--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id");--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_office_type_id_fkey" FOREIGN KEY ("office_type_id") REFERENCES "office_types"("id");--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_next_election_id_fkey" FOREIGN KEY ("next_election_id") REFERENCES "elections"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "office_powers" ADD CONSTRAINT "office_powers_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "office_powers" ADD CONSTRAINT "office_powers_power_id_fkey" FOREIGN KEY ("power_id") REFERENCES "powers"("id");--> statement-breakpoint
ALTER TABLE "office_issues" ADD CONSTRAINT "office_issues_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "office_issues" ADD CONSTRAINT "office_issues_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id");--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "filing_tracks" ADD CONSTRAINT "filing_tracks_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "elections"("id") ON DELETE SET NULL;