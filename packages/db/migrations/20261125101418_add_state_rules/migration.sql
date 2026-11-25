CREATE TABLE "state_rules" (
	"state" char(2) PRIMARY KEY,
	"signup" text DEFAULT 'allow' NOT NULL,
	"age_method" text DEFAULT 'store_signal_or_dob' NOT NULL,
	"candidate_tools" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_rules_state_check" CHECK ("state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "state_rules_signup_check" CHECK ("signup" in ('allow', 'withhold')),
	CONSTRAINT "state_rules_age_method_check" CHECK ("age_method" in ('store_signal_required', 'store_signal_or_dob'))
);
--> statement-breakpoint
ALTER TABLE "state_rules" ADD CONSTRAINT "state_rules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
insert into state_rules (state) values
  ('AL'), ('AK'), ('AZ'), ('AR'), ('CA'), ('CO'), ('CT'), ('DE'), ('FL'), ('GA'),
  ('HI'), ('ID'), ('IL'), ('IN'), ('IA'), ('KS'), ('KY'), ('LA'), ('ME'), ('MD'),
  ('MA'), ('MI'), ('MN'), ('MS'), ('MO'), ('MT'), ('NE'), ('NV'), ('NH'), ('NJ'),
  ('NM'), ('NY'), ('NC'), ('ND'), ('OH'), ('OK'), ('OR'), ('PA'), ('RI'), ('SC'),
  ('SD'), ('TN'), ('TX'), ('UT'), ('VT'), ('VA'), ('WA'), ('WV'), ('WI'), ('WY'),
  ('DC'), ('PR'), ('GU'), ('VI'), ('AS'), ('MP');