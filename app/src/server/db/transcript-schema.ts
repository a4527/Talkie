import { sql } from "drizzle-orm";
import { pgTable, uuid, integer, text, jsonb, timestamp, primaryKey, index, check } from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
// Separate instance, excluded from backups. State survives normal source deletion.
// Unknown historical timestamps remain NULL; no transcript or hash belongs here.
export const transcriptSessionStates = pgTable("transcript_session_states", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull(),
  transcriptStorageCreatedAt: time("transcript_storage_created_at"), firstNonemptySaveAt: time("first_nonempty_save_at"),
  transcriptDeleteDeadlineAt: time("transcript_delete_deadline_at"), sourceDeletedAt: time("source_deleted_at"), sourceDeletionReason: text("source_deletion_reason"),
}, t => [
  index("transcript_state_user").on(t.userId),
  check("transcript_source_deletion_pair", sql`(${t.sourceDeletedAt} is null) = (${t.sourceDeletionReason} is null)`),
  check("transcript_source_deletion_reason", sql`${t.sourceDeletionReason} in ('note_saved', 'no_user_turns', 'deadline_expired')`),
]);
export const transcriptSaves = pgTable("transcript_saves", {
  learningSessionId: uuid("learning_session_id").notNull().references(() => transcriptSessionStates.learningSessionId, { onDelete: "cascade" }),
  saveSequenceNumber: integer("save_sequence_number").notNull(), snapshotHash: text("snapshot_hash").notNull(), conversationSnapshot: jsonb("conversation_snapshot").notNull(),
}, t => [
  primaryKey({ columns: [t.learningSessionId, t.saveSequenceNumber] }),
  check("transcript_save_sequence_nonnegative", sql`${t.saveSequenceNumber} >= 0`),
]);
