CREATE TABLE "worker_heartbeats" (
	"worker" text PRIMARY KEY,
	"beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
