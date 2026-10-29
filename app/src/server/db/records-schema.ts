import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(), emailAddress: text("email_address").notNull().unique(),
  accountCreatedAt: time("account_created_at").notNull().defaultNow(), accountDeletionConfirmedAt: time("account_deletion_confirmed_at"),
});
export const emailAuthRateLimits = pgTable("email_auth_rate_limits", {
  emailAddress: text("email_address").primaryKey(), lastAuthEmailRequestedAt: time("last_auth_email_requested_at").notNull(),
});
export const emailAuthRequests = pgTable("email_auth_requests", {
  emailAuthRequestId: uuid("email_auth_request_id").primaryKey().defaultRandom(), emailAddress: text("email_address").notNull(),
  authenticationPurpose: text("authentication_purpose").notNull(), authLinkTokenHash: text("auth_link_token_hash").notNull().unique(),
  requestingLoginSessionId: uuid("requesting_login_session_id"), authLinkIssuedAt: time("auth_link_issued_at").notNull(), authLinkExpiresAt: time("auth_link_expires_at").notNull(),
  authLinkUsedAt: time("auth_link_used_at"), authLinkInvalidatedAt: time("auth_link_invalidated_at"), emailSendStatus: text("email_send_status").notNull().default("pending"),
}, t => [
  index("email_auth_request_email_purpose").on(t.emailAddress, t.authenticationPurpose),
  check("email_auth_request_purpose", sql`${t.authenticationPurpose} in ('login', 'account_deletion')`),
  check("email_auth_request_target", sql`(${t.authenticationPurpose} = 'login' and ${t.requestingLoginSessionId} is null) or (${t.authenticationPurpose} = 'account_deletion' and ${t.requestingLoginSessionId} is not null)`),
  check("email_auth_request_send_status", sql`${t.emailSendStatus} in ('pending', 'smtp_accepted', 'failed_or_unknown')`),
]);
export const loginSessions = pgTable("login_sessions", {
  loginSessionId: uuid("login_session_id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  loginTokenHash: text("login_token_hash").notNull().unique(), loginSessionCreatedAt: time("login_session_created_at").notNull(),
  lastAuthenticatedActivityAt: time("last_authenticated_activity_at").notNull(), loginSessionExpiresAt: time("login_session_expires_at").notNull(), loginSessionInvalidatedAt: time("login_session_invalidated_at"),
  accountDeletionAuthorizationExpiresAt: time("account_deletion_authorization_expires_at"), accountDeletionAuthorizationUsedAt: time("account_deletion_authorization_used_at"),
}, t => [
  index("login_session_user").on(t.userId),
  check("account_deletion_authorization_use", sql`${t.accountDeletionAuthorizationUsedAt} is null or ${t.accountDeletionAuthorizationExpiresAt} is not null`),
]);
export const learningSessions = pgTable("learning_sessions", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  learningSessionStatus: text("learning_session_status").notNull().default("active"), confirmedSaveSequenceNumber: integer("confirmed_save_sequence_number").notNull().default(0),
  learningSessionStartedAt: time("learning_session_started_at").notNull(), learningSessionInterruptedAt: time("learning_session_interrupted_at"), learningSessionEndedAt: time("learning_session_ended_at"),
  transcriptDeleteDeadlineAt: time("transcript_delete_deadline_at"), noteGenerationStatus: text("note_generation_status").notNull().default("idle"),
  learningConnectionTokenHash: text("learning_connection_token_hash"), learningConnectionExpiresAt: time("learning_connection_expires_at"), demoScenario: text("demo_scenario").notNull().default("correction"),
}, t => [
  uniqueIndex("one_open_learning_session").on(t.userId).where(sql`${t.learningSessionStatus} in ('active', 'interrupted')`),
  uniqueIndex("learning_session_owner").on(t.learningSessionId, t.userId), index("learning_session_user").on(t.userId),
  check("learning_session_status", sql`${t.learningSessionStatus} in ('active', 'interrupted', 'ended')`),
  check("confirmed_save_sequence_nonnegative", sql`${t.confirmedSaveSequenceNumber} >= 0`),
  check("note_generation_status", sql`${t.noteGenerationStatus} in ('idle', 'waiting_save', 'pending', 'ready', 'empty', 'expired')`),
  check("learning_demo_scenario", sql`${t.demoScenario} in ('correction', 'conversation', 'voice')`),
]);
export const learningSessionNotes = pgTable("learning_session_notes", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  learningEndDateKst: text("learning_end_date_kst").notNull(), noteMarkdown: text("note_markdown").notNull(), noteRetentionExpiresAt: time("note_retention_expires_at").notNull(),
}, t => [
  foreignKey({ name: "learning_note_session_owner", columns: [t.learningSessionId, t.userId], foreignColumns: [learningSessions.learningSessionId, learningSessions.userId] }).onDelete("cascade"),
  index("learning_note_user_expiry").on(t.userId, t.noteRetentionExpiresAt),
]);
export const scheduledJobs = pgTable("scheduled_jobs", {
  scheduledJobId: uuid("scheduled_job_id").primaryKey().defaultRandom(), targetUserId: uuid("target_user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  targetLearningSessionId: uuid("target_learning_session_id"), jobType: text("job_type").notNull(), scheduledRunAt: time("scheduled_run_at").notNull(),
}, t => [
  foreignKey({ name: "scheduled_job_session_owner", columns: [t.targetLearningSessionId, t.targetUserId], foreignColumns: [learningSessions.learningSessionId, learningSessions.userId] }).onDelete("cascade"),
  uniqueIndex("scheduled_account_job_target").on(t.jobType, t.targetUserId).where(sql`${t.targetLearningSessionId} is null`),
  uniqueIndex("scheduled_session_job_target").on(t.jobType, t.targetLearningSessionId).where(sql`${t.targetLearningSessionId} is not null`),
  index("scheduled_job_user").on(t.targetUserId),
  check("scheduled_job_target", sql`(${t.jobType} = 'delete_account' and ${t.targetLearningSessionId} is null) or (${t.jobType} = 'note' and ${t.targetLearningSessionId} is not null)`),
]);
