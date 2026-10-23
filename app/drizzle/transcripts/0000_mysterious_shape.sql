CREATE TABLE "transcript_versions" (
	"session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"digest" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "transcript_versions_session_id_version_pk" PRIMARY KEY("session_id","version")
);
--> statement-breakpoint
CREATE TABLE "transcript_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"digest" text NOT NULL,
	"payload" jsonb NOT NULL,
	"erase_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transcript_versions" ADD CONSTRAINT "transcript_versions_session_id_transcript_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."transcript_sessions"("session_id") ON DELETE cascade ON UPDATE no action;