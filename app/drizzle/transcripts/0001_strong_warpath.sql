CREATE TABLE "transcript_lifecycle" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone,
	"first_saved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text
);
--> statement-breakpoint
ALTER TABLE "transcript_sessions" RENAME COLUMN "erase_at" TO "transcript_delete_deadline_at";
--> statement-breakpoint
-- Existing source rows are known to exist, but their historical creation/save
-- times were not recorded. Leave those times NULL instead of inventing them.
INSERT INTO "transcript_lifecycle" ("session_id", "user_id")
SELECT "session_id", "user_id" FROM "transcript_sessions";
