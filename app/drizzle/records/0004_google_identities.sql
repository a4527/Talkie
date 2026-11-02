CREATE TABLE "google_identities" (
	"google_subject" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"google_email_address" text NOT NULL,
	"google_identity_linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "google_identities_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "google_identities" ADD CONSTRAINT "google_identities_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;