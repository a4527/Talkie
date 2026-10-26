-- Run with the web server/jobs stopped. Drizzle applies this file in a transaction.
-- Rename/copy rather than drop/recreate account, note, token or session data.
LOCK TABLE users, auth_request_controls, auth_challenges, auth_sessions, deletion_confirmations, learning_sessions, session_notes, scheduled_jobs IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "deletion_confirmations" DROP CONSTRAINT "deletion_confirmations_session_id_auth_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" DROP CONSTRAINT "scheduled_jobs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "learning_sessions" DROP CONSTRAINT "learning_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "session_notes" DROP CONSTRAINT "session_notes_session_id_learning_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "session_notes" DROP CONSTRAINT "session_notes_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "challenge_email_purpose";
--> statement-breakpoint
DROP INDEX "job_target";
--> statement-breakpoint
DROP INDEX "one_open_learning_session";
--> statement-breakpoint
ALTER TABLE "auth_request_controls" RENAME TO "email_auth_rate_limits";
--> statement-breakpoint
ALTER TABLE "auth_challenges" RENAME TO "email_auth_requests";
--> statement-breakpoint
ALTER TABLE "auth_sessions" RENAME TO "login_sessions";
--> statement-breakpoint
ALTER TABLE "session_notes" RENAME TO "learning_session_notes";
--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "id" TO "user_id";
--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "email" TO "email_address";
--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "created_at" TO "account_created_at";
--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "deleted_at" TO "account_deletion_confirmed_at";
--> statement-breakpoint
ALTER TABLE "email_auth_rate_limits" RENAME COLUMN "email" TO "email_address";
--> statement-breakpoint
ALTER TABLE "email_auth_rate_limits" RENAME COLUMN "requested_at" TO "last_auth_email_requested_at";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "id" TO "email_auth_request_id";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "email" TO "email_address";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "purpose" TO "authentication_purpose";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "token_hash" TO "auth_link_token_hash";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "session_id" TO "requesting_login_session_id";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "created_at" TO "auth_link_issued_at";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "expires_at" TO "auth_link_expires_at";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "consumed_at" TO "auth_link_used_at";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "revoked_at" TO "auth_link_invalidated_at";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME COLUMN "delivery" TO "email_send_status";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME COLUMN "id" TO "login_session_id";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME COLUMN "token_hash" TO "login_token_hash";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME COLUMN "created_at" TO "login_session_created_at";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME COLUMN "last_seen_at" TO "last_authenticated_activity_at";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME COLUMN "expires_at" TO "login_session_expires_at";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME COLUMN "revoked_at" TO "login_session_invalidated_at";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "id" TO "learning_session_id";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "status" TO "learning_session_status";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "version" TO "confirmed_save_sequence_number";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "created_at" TO "learning_session_started_at";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "interrupted_at" TO "learning_session_interrupted_at";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "ended_at" TO "learning_session_ended_at";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "note_status" TO "note_generation_status";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "connection_hash" TO "learning_connection_token_hash";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "lease_until" TO "learning_connection_expires_at";
--> statement-breakpoint
ALTER TABLE "learning_sessions" RENAME COLUMN "scenario" TO "demo_scenario";
--> statement-breakpoint
ALTER TABLE "learning_session_notes" RENAME COLUMN "session_id" TO "learning_session_id";
--> statement-breakpoint
ALTER TABLE "learning_session_notes" RENAME COLUMN "date" TO "learning_end_date_kst";
--> statement-breakpoint
ALTER TABLE "learning_session_notes" RENAME COLUMN "markdown" TO "note_markdown";
--> statement-breakpoint
ALTER TABLE "learning_session_notes" RENAME COLUMN "expires_at" TO "note_retention_expires_at";
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" RENAME COLUMN "id" TO "scheduled_job_id";
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" RENAME COLUMN "user_id" TO "target_user_id";
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" RENAME COLUMN "session_id" TO "target_learning_session_id";
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" RENAME COLUMN "kind" TO "job_type";
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" RENAME COLUMN "due_at" TO "scheduled_run_at";
--> statement-breakpoint
ALTER TABLE login_sessions ADD COLUMN account_deletion_authorization_expires_at timestamptz, ADD COLUMN account_deletion_authorization_used_at timestamptz;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM deletion_confirmations d LEFT JOIN login_sessions s ON s.login_session_id = d.session_id WHERE s.login_session_id IS NULL) THEN
  RAISE EXCEPTION 'DELETION_AUTHORIZATION_OWNER_MISSING';
 END IF;
END $$;
--> statement-breakpoint
UPDATE login_sessions s SET account_deletion_authorization_expires_at = d.expires_at, account_deletion_authorization_used_at = d.consumed_at
FROM deletion_confirmations d WHERE s.login_session_id = d.session_id;
--> statement-breakpoint
DROP TABLE deletion_confirmations;
--> statement-breakpoint
UPDATE email_auth_requests SET authentication_purpose = 'account_deletion' WHERE authentication_purpose = 'delete';
--> statement-breakpoint
UPDATE email_auth_requests SET email_send_status = 'smtp_accepted' WHERE email_send_status = 'accepted';
--> statement-breakpoint
ALTER TABLE users RENAME CONSTRAINT users_email_unique TO users_email_address_unique;
--> statement-breakpoint
ALTER TABLE login_sessions RENAME CONSTRAINT auth_sessions_token_hash_unique TO login_sessions_login_token_hash_unique;
--> statement-breakpoint
ALTER TABLE email_auth_requests RENAME CONSTRAINT auth_challenges_token_hash_unique TO email_auth_requests_auth_link_token_hash_unique;
--> statement-breakpoint
ALTER TABLE "email_auth_rate_limits" RENAME CONSTRAINT "auth_request_controls_pkey" TO "email_auth_rate_limits_pkey";
--> statement-breakpoint
ALTER TABLE "email_auth_requests" RENAME CONSTRAINT "auth_challenges_pkey" TO "email_auth_requests_pkey";
--> statement-breakpoint
ALTER TABLE "login_sessions" RENAME CONSTRAINT "auth_sessions_pkey" TO "login_sessions_pkey";
--> statement-breakpoint
ALTER TABLE "learning_session_notes" RENAME CONSTRAINT "session_notes_pkey" TO "learning_session_notes_pkey";
--> statement-breakpoint
CREATE INDEX "email_auth_request_email_purpose" ON "email_auth_requests" USING btree ("email_address", "authentication_purpose");
--> statement-breakpoint
ALTER TABLE "email_auth_requests" ADD CONSTRAINT "email_auth_request_purpose" CHECK ("email_auth_requests"."authentication_purpose" in ('login', 'account_deletion'));
--> statement-breakpoint
ALTER TABLE "email_auth_requests" ADD CONSTRAINT "email_auth_request_target" CHECK (("email_auth_requests"."authentication_purpose" = 'login' and "email_auth_requests"."requesting_login_session_id" is null) or ("email_auth_requests"."authentication_purpose" = 'account_deletion' and "email_auth_requests"."requesting_login_session_id" is not null));
--> statement-breakpoint
ALTER TABLE "email_auth_requests" ADD CONSTRAINT "email_auth_request_send_status" CHECK ("email_auth_requests"."email_send_status" in ('pending', 'smtp_accepted', 'failed_or_unknown'));
--> statement-breakpoint
CREATE INDEX "learning_note_user_expiry" ON "learning_session_notes" USING btree ("user_id", "note_retention_expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_learning_session" ON "learning_sessions" USING btree ("user_id") WHERE "learning_sessions"."learning_session_status" in ('active', 'interrupted');
--> statement-breakpoint
CREATE UNIQUE INDEX "learning_session_owner" ON "learning_sessions" USING btree ("learning_session_id", "user_id");
--> statement-breakpoint
CREATE INDEX "learning_session_user" ON "learning_sessions" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_session_status" CHECK ("learning_sessions"."learning_session_status" in ('active', 'interrupted', 'ended'));
--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "confirmed_save_sequence_nonnegative" CHECK ("learning_sessions"."confirmed_save_sequence_number" >= 0);
--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "note_generation_status" CHECK ("learning_sessions"."note_generation_status" in ('idle', 'waiting_save', 'pending', 'ready', 'empty', 'expired'));
--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_demo_scenario" CHECK ("learning_sessions"."demo_scenario" in ('correction', 'conversation'));
--> statement-breakpoint
CREATE INDEX "login_session_user" ON "login_sessions" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "login_sessions" ADD CONSTRAINT "account_deletion_authorization_use" CHECK ("login_sessions"."account_deletion_authorization_used_at" is null or "login_sessions"."account_deletion_authorization_expires_at" is not null);
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_account_job_target" ON "scheduled_jobs" USING btree ("job_type", "target_user_id") WHERE "scheduled_jobs"."target_learning_session_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_session_job_target" ON "scheduled_jobs" USING btree ("job_type", "target_learning_session_id") WHERE "scheduled_jobs"."target_learning_session_id" is not null;
--> statement-breakpoint
CREATE INDEX "scheduled_job_user" ON "scheduled_jobs" USING btree ("target_user_id");
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_job_target" CHECK (("scheduled_jobs"."job_type" = 'delete_account' and "scheduled_jobs"."target_learning_session_id" is null) or ("scheduled_jobs"."job_type" = 'note' and "scheduled_jobs"."target_learning_session_id" is not null));
--> statement-breakpoint
ALTER TABLE "learning_session_notes" ADD CONSTRAINT "learning_session_notes_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_session_notes" ADD CONSTRAINT "learning_note_session_owner" FOREIGN KEY ("learning_session_id", "user_id") REFERENCES "public"."learning_sessions" ("learning_session_id", "user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_target_user_id_users_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users" ("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_job_session_owner" FOREIGN KEY ("target_learning_session_id", "target_user_id") REFERENCES "public"."learning_sessions" ("learning_session_id", "user_id") ON DELETE cascade ON UPDATE no action;
