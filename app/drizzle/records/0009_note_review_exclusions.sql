CREATE TABLE "learning_note_review_exclusions" (
	"learning_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"review_item_number" integer NOT NULL,
	"excluded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "learning_note_review_exclusion_pk" PRIMARY KEY("learning_session_id","review_item_number"),
	CONSTRAINT "learning_note_review_item_positive" CHECK ("learning_note_review_exclusions"."review_item_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "learning_note_review_exclusions" ADD CONSTRAINT "learning_note_review_exclusion_note" FOREIGN KEY ("learning_session_id") REFERENCES "public"."learning_session_notes"("learning_session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_note_review_exclusions" ADD CONSTRAINT "learning_note_review_exclusion_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_note_review_exclusion_user_index" ON "learning_note_review_exclusions" USING btree ("user_id");