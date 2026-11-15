CREATE TABLE "learning_session_missions" (
	"learning_session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mission_id" text NOT NULL,
	"definition_version" integer NOT NULL,
	"rubric_version" integer NOT NULL,
	"mission_mode" text NOT NULL,
	"language_level" text NOT NULL,
	"mission_end_reason" text,
	"final_route_id" text,
	CONSTRAINT "learning_mission_mode" CHECK ("learning_session_missions"."mission_mode" in ('practice', 'real')),
	CONSTRAINT "learning_mission_level" CHECK ("learning_session_missions"."language_level" in ('A1', 'A2', 'B1', 'B2', 'C')),
	CONSTRAINT "learning_mission_versions" CHECK ("learning_session_missions"."definition_version" >= 1 and "learning_session_missions"."rubric_version" >= 1),
	CONSTRAINT "learning_mission_end_reason" CHECK ("learning_session_missions"."mission_end_reason" in ('goal_completed', 'no_progress_failed', 'user_ended', 'resume_expired')),
	CONSTRAINT "learning_mission_final_route" CHECK ("learning_session_missions"."final_route_id" is null or "learning_session_missions"."mission_end_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "learning_session_missions" ADD CONSTRAINT "learning_session_missions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_session_missions" ADD CONSTRAINT "learning_mission_session_owner" FOREIGN KEY ("learning_session_id","user_id") REFERENCES "public"."learning_sessions"("learning_session_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_mission_user" ON "learning_session_missions" USING btree ("user_id");