CREATE TABLE "users" (
	"id" uuid PRIMARY KEY,
	"handle" citext CONSTRAINT "users_handle_key" UNIQUE,
	"name" text,
	"bio" text,
	"bio_held" boolean DEFAULT false NOT NULL,
	"bio_ai_screen_status" text,
	"link" text,
	"avatar_key" text,
	"avatar_pending_key" text,
	"email" citext CONSTRAINT "users_email_key" UNIQUE,
	"email_status" text DEFAULT 'ok' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"deletion_requested_at" timestamp with time zone,
	"age_method" text,
	"age_result" text,
	"age_source_tier" text,
	"age_checked_at" timestamp with time zone,
	"onboarding_step" text DEFAULT 'photo' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"dm_policy" text DEFAULT 'everyone' NOT NULL,
	"tag_policy" text DEFAULT 'everyone' NOT NULL,
	"personalize" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"accepts_help" boolean DEFAULT true NOT NULL,
	"notification_settings" jsonb DEFAULT '{}' NOT NULL,
	"location_precision" text,
	"districts_stale_at" timestamp with time zone,
	"handle_changed_at" timestamp with time zone,
	"calendar_token_hash" text CONSTRAINT "users_calendar_token_hash_key" UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_check" CHECK ("handle"::text ~ '^[a-z0-9_.]{3,20}$'),
	CONSTRAINT "users_link_check" CHECK ("link" like 'https://%'),
	CONSTRAINT "users_bio_ai_screen_status_check" CHECK ("bio_ai_screen_status" in ('ok', 'refused', 'error', 'budget')),
	CONSTRAINT "users_email_status_check" CHECK ("email_status" in ('ok', 'bounced', 'complained', 'disabled')),
	CONSTRAINT "users_role_check" CHECK ("role" in ('user', 'admin')),
	CONSTRAINT "users_status_check" CHECK ("status" in ('active', 'suspended', 'deleting')),
	CONSTRAINT "users_suspended_reason_check" CHECK ("suspended_reason" in ('content_policy', 'spam', 'impersonation', 'copyright', 'under_18', 'legal', 'other')),
	CONSTRAINT "users_suspended_at_check" CHECK ("status" <> 'suspended' or "suspended_at" is not null),
	CONSTRAINT "users_age_method_check" CHECK ("age_method" in ('store_signal', 'self_declared')),
	CONSTRAINT "users_age_result_check" CHECK ("age_result" in ('adult')),
	CONSTRAINT "users_age_source_tier_check" CHECK ("age_source_tier" in ('confirmed', 'declared', 'self')),
	CONSTRAINT "users_age_record_check" CHECK (num_nulls("age_method", "age_result", "age_source_tier", "age_checked_at") in (0, 4)),
	CONSTRAINT "users_onboarding_step_check" CHECK ("onboarding_step" in ('photo', 'handle', 'issues', 'location', 'done')),
	CONSTRAINT "users_dm_policy_check" CHECK ("dm_policy" in ('everyone', 'following', 'none')),
	CONSTRAINT "users_tag_policy_check" CHECK ("tag_policy" in ('everyone', 'following', 'none')),
	CONSTRAINT "users_locale_check" CHECK ("locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "users_location_precision_check" CHECK ("location_precision" in ('exact', 'approx'))
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"refresh_token_enc" bytea,
	"client_id" text,
	"is_private_email" boolean,
	"email" citext,
	"email_verified" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_pkey" PRIMARY KEY("provider","subject"),
	CONSTRAINT "auth_identities_provider_check" CHECK ("provider" in ('email', 'apple', 'google'))
);
--> statement-breakpoint
CREATE TABLE "email_codes" (
	"id" uuid PRIMARY KEY,
	"email" citext NOT NULL,
	"pending_token_hash" text NOT NULL CONSTRAINT "email_codes_pending_token_hash_key" UNIQUE,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "sessions_token_hash_key" UNIQUE,
	"platform" text NOT NULL,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_platform_check" CHECK ("platform" in ('ios', 'android', 'web'))
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY,
	"kind" text NOT NULL,
	"secret_hash" text NOT NULL CONSTRAINT "auth_challenges_secret_hash_key" UNIQUE,
	"user_id" uuid,
	"session_id" uuid,
	"platform" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenges_kind_check" CHECK ("kind" in ('nonce', 'apple_handoff', 'ws_ticket')),
	CONSTRAINT "auth_challenges_platform_check" CHECK ("platform" in ('ios', 'android', 'web')),
	CONSTRAINT "auth_challenges_session_id_check" CHECK ("session_id" is null or "kind" = 'ws_ticket')
);
--> statement-breakpoint
CREATE TABLE "user_consents" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_consents_kind_check" CHECK ("kind" in ('terms', 'content_policy', 'privacy_policy', 'ai_screening')),
	CONSTRAINT "user_consents_platform_check" CHECK ("platform" in ('ios', 'android', 'web'))
);
--> statement-breakpoint
CREATE TABLE "reserved_handles" (
	"handle_hash" text PRIMARY KEY,
	"reason" text NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reserved_handles_reason_check" CHECK ("reason" in ('released', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "user_issues" (
	"user_id" uuid NOT NULL,
	"issue_id" text NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_issues_pkey" PRIMARY KEY("user_id","issue_id")
);
--> statement-breakpoint
CREATE INDEX "auth_challenges_expires" ON "auth_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_challenges_session" ON "auth_challenges" ("session_id") WHERE "session_id" is not null;--> statement-breakpoint
CREATE INDEX "auth_identities_user" ON "auth_identities" ("user_id");--> statement-breakpoint
CREATE INDEX "email_codes_email" ON "email_codes" ("email","created_at");--> statement-breakpoint
CREATE INDEX "reserved_handles_until" ON "reserved_handles" ("reserved_until");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "user_consents_user" ON "user_consents" ("user_id","kind","id" DESC);--> statement-breakpoint
CREATE INDEX "users_handle_trgm" ON "users" USING gin (("handle"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_name_trgm" ON "users" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_not_active" ON "users" ("status","deletion_requested_at") WHERE "status" <> 'active';--> statement-breakpoint
CREATE INDEX "users_bio_held" ON "users" ("id") WHERE "bio_held";--> statement-breakpoint
CREATE INDEX "users_age_unset" ON "users" ("created_at") WHERE "age_method" is null;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_issues" ADD CONSTRAINT "user_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_issues" ADD CONSTRAINT "user_issues_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id");