import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(), email: text("email").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(), deletedAt: time("deleted_at"),
});
export const controls = pgTable("auth_request_controls", {
  email: text("email").primaryKey(), requestedAt: time("requested_at").notNull(),
});
export const challenges = pgTable("auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(), email: text("email").notNull(),
  purpose: text("purpose").notNull(), tokenHash: text("token_hash").notNull().unique(),
  sessionId: uuid("session_id"), createdAt: time("created_at").notNull(), expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"), revokedAt: time("revoked_at"), delivery: text("delivery").notNull().default("pending"),
}, t => [index("challenge_email_purpose").on(t.email, t.purpose)]);
export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), createdAt: time("created_at").notNull(),
  lastSeenAt: time("last_seen_at").notNull(), expiresAt: time("expires_at").notNull(), revokedAt: time("revoked_at"),
});
export const deletionConfirmations = pgTable("deletion_confirmations", {
  sessionId: uuid("session_id").primaryKey().references(() => authSessions.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(), consumedAt: time("consumed_at"),
});
export const learningSessions = pgTable("learning_sessions", {
  id: uuid("id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), version: integer("version").notNull().default(0),
  createdAt: time("created_at").notNull(), interruptedAt: time("interrupted_at"), endedAt: time("ended_at"),
  eraseAt: time("erase_at"), noteStatus: text("note_status").notNull().default("idle"),
  connectionHash: text("connection_hash"), leaseUntil: time("lease_until"), scenario: text("scenario").notNull().default("correction"),
}, t => [uniqueIndex("one_open_learning_session").on(t.userId).where(sql`${t.status} in ('active', 'interrupted')`)]);
export const notes = pgTable("session_notes", {
  sessionId: uuid("session_id").primaryKey().references(() => learningSessions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(), markdown: text("markdown").notNull(), expiresAt: time("expires_at").notNull(),
});
export const jobs = pgTable("scheduled_jobs", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id"), kind: text("kind").notNull(), dueAt: time("due_at").notNull(),
}, t => [uniqueIndex("job_target").on(t.kind, t.userId, t.sessionId)]);
