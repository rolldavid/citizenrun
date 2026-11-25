CREATE UNLOGGED TABLE "rate_limits" (
	"key" text COLLATE "C" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("key","window_start")
) WITH (fillfactor = 70);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"name" text NOT NULL,
	"period" date NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_pkey" PRIMARY KEY("name","period")
);
--> statement-breakpoint
CREATE INDEX "rate_limits_window" ON "rate_limits" ("window_start");