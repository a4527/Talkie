CREATE TABLE "mission_usage_holds" (
	"learning_session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"usage_status" text DEFAULT 'held' NOT NULL,
	"held_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "mission_usage_status" CHECK ("mission_usage_holds"."usage_status" in ('held', 'confirmed', 'released')),
	CONSTRAINT "mission_usage_settled" CHECK (("mission_usage_holds"."usage_status" = 'held') = ("mission_usage_holds"."settled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "mission_usage_holds" ADD CONSTRAINT "mission_usage_holds_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_usage_user_status" ON "mission_usage_holds" USING btree ("user_id","usage_status");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_usage_one_held" ON "mission_usage_holds" USING btree ("user_id") WHERE "mission_usage_holds"."usage_status" = 'held';