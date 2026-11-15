CREATE TABLE "learning_mission_result_details" (
	"learning_session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"judgements" jsonb NOT NULL,
	"detail_retention_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_mission_results" (
	"learning_session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"evaluation_status" text NOT NULL,
	"area_scores" jsonb,
	"total_earned_half" integer,
	"total_max_half" integer,
	"meets_threshold" boolean,
	"evaluated_at" timestamp with time zone,
	CONSTRAINT "learning_mission_result_status" CHECK ("learning_mission_results"."evaluation_status" in ('pending', 'ready', 'skipped', 'unavailable')),
	CONSTRAINT "learning_mission_result_scores" CHECK (("learning_mission_results"."evaluation_status" = 'ready') = ("learning_mission_results"."area_scores" is not null and "learning_mission_results"."total_earned_half" is not null and "learning_mission_results"."total_max_half" is not null and "learning_mission_results"."evaluated_at" is not null)),
	CONSTRAINT "learning_mission_result_range" CHECK ("learning_mission_results"."total_earned_half" is null or ("learning_mission_results"."total_earned_half" >= 0 and "learning_mission_results"."total_earned_half" <= "learning_mission_results"."total_max_half")),
	CONSTRAINT "learning_mission_result_threshold" CHECK ("learning_mission_results"."meets_threshold" is null or ("learning_mission_results"."evaluation_status" = 'ready' and "learning_mission_results"."total_max_half" > 0))
);
--> statement-breakpoint
ALTER TABLE "learning_mission_result_details" ADD CONSTRAINT "learning_mission_result_details_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_mission_result_details" ADD CONSTRAINT "learning_mission_detail_session_owner" FOREIGN KEY ("learning_session_id","user_id") REFERENCES "public"."learning_sessions"("learning_session_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_mission_results" ADD CONSTRAINT "learning_mission_results_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_mission_results" ADD CONSTRAINT "learning_mission_result_session_owner" FOREIGN KEY ("learning_session_id","user_id") REFERENCES "public"."learning_sessions"("learning_session_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_mission_detail_user_expiry" ON "learning_mission_result_details" USING btree ("user_id","detail_retention_expires_at");--> statement-breakpoint
CREATE INDEX "learning_mission_result_user" ON "learning_mission_results" USING btree ("user_id");