import { pgTable, uuid, integer, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
// Stored ONLY in the separate instance. No cross-instance foreign keys or transcript backup.
export const transcripts = pgTable("transcript_sessions", {
  sessionId: uuid("session_id").primaryKey(), userId: uuid("user_id").notNull(),
  version: integer("version").notNull(), digest: text("digest").notNull(),
  payload: jsonb("payload").notNull(), eraseAt: time("erase_at"),
});
export const transcriptVersions = pgTable("transcript_versions", {
  sessionId: uuid("session_id").notNull().references(() => transcripts.sessionId, { onDelete: "cascade" }),
  version: integer("version").notNull(), digest: text("digest").notNull(), payload: jsonb("payload").notNull(),
}, t => [primaryKey({ columns: [t.sessionId, t.version] })]);
