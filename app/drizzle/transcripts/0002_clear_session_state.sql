-- Preserve all save numbers, snapshots, hashes and known/unknown timestamps.
LOCK TABLE transcript_sessions, transcript_versions, transcript_lifecycle IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM transcript_sessions s JOIN transcript_lifecycle l USING(session_id) WHERE s.user_id <> l.user_id OR l.deleted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'TRANSCRIPT_STATE_CONFLICT';
 END IF;
 IF EXISTS (
  SELECT 1 FROM transcript_sessions s
  WHERE s.payload NOT IN ('{}'::jsonb, '{"turns":[],"corrections":[],"learning":"conversation","gaps":false}'::jsonb)
    AND NOT EXISTS (SELECT 1 FROM transcript_versions v WHERE v.session_id=s.session_id AND v.payload=s.payload AND v.digest=s.digest)
 ) THEN
  RAISE EXCEPTION 'TRANSCRIPT_INITIAL_CONTENT_NOT_PRESERVED';
 END IF;
 IF EXISTS (SELECT 1 FROM transcript_lifecycle l LEFT JOIN transcript_sessions s USING(session_id) WHERE l.deleted_at IS NULL AND s.session_id IS NULL) THEN
  RAISE EXCEPTION 'TRANSCRIPT_SOURCE_STATE_UNKNOWN';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO transcript_lifecycle(session_id,user_id)
SELECT s.session_id,s.user_id FROM transcript_sessions s
WHERE NOT EXISTS (SELECT 1 FROM transcript_lifecycle l WHERE l.session_id=s.session_id);
--> statement-breakpoint
ALTER TABLE transcript_lifecycle ADD COLUMN transcript_delete_deadline_at timestamptz;
--> statement-breakpoint
UPDATE transcript_lifecycle l SET transcript_delete_deadline_at=s.transcript_delete_deadline_at
FROM transcript_sessions s WHERE l.session_id=s.session_id;
--> statement-breakpoint
ALTER TABLE transcript_versions DROP CONSTRAINT transcript_versions_session_id_transcript_sessions_session_id_fk;
--> statement-breakpoint
ALTER TABLE transcript_lifecycle RENAME TO transcript_session_states;
--> statement-breakpoint
ALTER TABLE transcript_versions RENAME TO transcript_saves;
--> statement-breakpoint
ALTER TABLE "transcript_session_states" RENAME COLUMN "session_id" TO "learning_session_id";
--> statement-breakpoint
ALTER TABLE "transcript_session_states" RENAME COLUMN "created_at" TO "transcript_storage_created_at";
--> statement-breakpoint
ALTER TABLE "transcript_session_states" RENAME COLUMN "first_saved_at" TO "first_nonempty_save_at";
--> statement-breakpoint
ALTER TABLE "transcript_session_states" RENAME COLUMN "deleted_at" TO "source_deleted_at";
--> statement-breakpoint
ALTER TABLE "transcript_session_states" RENAME COLUMN "deletion_reason" TO "source_deletion_reason";
--> statement-breakpoint
ALTER TABLE "transcript_saves" RENAME COLUMN "session_id" TO "learning_session_id";
--> statement-breakpoint
ALTER TABLE "transcript_saves" RENAME COLUMN "version" TO "save_sequence_number";
--> statement-breakpoint
ALTER TABLE "transcript_saves" RENAME COLUMN "digest" TO "snapshot_hash";
--> statement-breakpoint
ALTER TABLE "transcript_saves" RENAME COLUMN "payload" TO "conversation_snapshot";
--> statement-breakpoint
ALTER TABLE transcript_session_states RENAME CONSTRAINT transcript_lifecycle_pkey TO transcript_session_states_pkey;
--> statement-breakpoint
ALTER TABLE transcript_saves RENAME CONSTRAINT transcript_versions_session_id_version_pk TO transcript_saves_learning_session_id_save_sequence_number_pk;
--> statement-breakpoint
ALTER TABLE "transcript_saves" ADD CONSTRAINT "transcript_save_sequence_nonnegative" CHECK ("transcript_saves"."save_sequence_number" >= 0);
--> statement-breakpoint
CREATE INDEX "transcript_state_user" ON "transcript_session_states" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "transcript_session_states" ADD CONSTRAINT "transcript_source_deletion_pair" CHECK (("transcript_session_states"."source_deleted_at" is null) = ("transcript_session_states"."source_deletion_reason" is null));
--> statement-breakpoint
ALTER TABLE "transcript_session_states" ADD CONSTRAINT "transcript_source_deletion_reason" CHECK ("transcript_session_states"."source_deletion_reason" in ('note_saved', 'no_user_turns', 'deadline_expired'));
--> statement-breakpoint
ALTER TABLE "transcript_saves" ADD CONSTRAINT "transcript_saves_learning_session_id_transcript_session_states_learning_session_id_fk" FOREIGN KEY ("learning_session_id") REFERENCES "public"."transcript_session_states" ("learning_session_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Only unused initial values remain in this table; saves now reference the retained state.
DROP TABLE transcript_sessions;
