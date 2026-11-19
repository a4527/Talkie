import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, uniqueIndex, index, check, foreignKey, primaryKey } from "drizzle-orm/pg-core";

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
/** Review items of a note the learner turned off (DEC-098). The note text is unchanged; rows go with the note. */
export const learningNoteReviewExclusions = pgTable("learning_note_review_exclusions", {
  learningSessionId: uuid("learning_session_id").notNull(), userId: uuid("user_id").notNull(),
  reviewItemNumber: integer("review_item_number").notNull(), excludedAt: time("excluded_at").notNull(),
}, t => [
  primaryKey({ name: "learning_note_review_exclusion_pk", columns: [t.learningSessionId, t.reviewItemNumber] }),
  foreignKey({ name: "learning_note_review_exclusion_note", columns: [t.learningSessionId], foreignColumns: [learningSessionNotes.learningSessionId] }).onDelete("cascade"),
  foreignKey({ name: "learning_note_review_exclusion_user", columns: [t.userId], foreignColumns: [users.userId] }).onDelete("cascade"),
  index("learning_note_review_exclusion_user_index").on(t.userId),
  check("learning_note_review_item_positive", sql`${t.reviewItemNumber} > 0`),
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
/** Google OIDC subject linked to one app account (DEC-067). Removed with the user row. */
export const googleIdentities = pgTable("google_identities", {
  googleSubject: text("google_subject").primaryKey(), userId: uuid("user_id").notNull().unique().references(() => users.userId, { onDelete: "cascade" }),
  googleEmailAddress: text("google_email_address").notNull(), googleIdentityLinkedAt: time("google_identity_linked_at").notNull(),
});
/** Mission, mode and level fixed at start (DEC-086, MISSIONS 최소 연결 계약). Fixed columns never change; end reason and final route are written once. */
export const learningSessionMissions = pgTable("learning_session_missions", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  missionId: text("mission_id").notNull(), definitionVersion: integer("definition_version").notNull(), rubricVersion: integer("rubric_version").notNull(),
  missionMode: text("mission_mode").notNull(), languageLevel: text("language_level").notNull(),
  missionEndReason: text("mission_end_reason"), finalRouteId: text("final_route_id"),
  /** Browser IANA time zone fixed at start; the achievement day is the end time's local date in it (DEC-095). */
  missionTimeZone: text("mission_time_zone").notNull().default("Asia/Seoul"),
}, t => [
  foreignKey({ name: "learning_mission_session_owner", columns: [t.learningSessionId, t.userId], foreignColumns: [learningSessions.learningSessionId, learningSessions.userId] }).onDelete("cascade"),
  index("learning_mission_user").on(t.userId),
  check("learning_mission_mode", sql`${t.missionMode} in ('practice', 'real')`),
  check("learning_mission_level", sql`${t.languageLevel} in ('A1', 'A2', 'B1', 'B2', 'C')`),
  check("learning_mission_versions", sql`${t.definitionVersion} >= 1 and ${t.rubricVersion} >= 1`),
  check("learning_mission_end_reason", sql`${t.missionEndReason} in ('goal_completed', 'no_progress_failed', 'user_ended', 'resume_expired')`),
  check("learning_mission_final_route", sql`${t.finalRouteId} is null or ${t.missionEndReason} is not null`),
]);
/**
 * Mission result aggregate (DEC-088): kept until account deletion, with no learner utterance text.
 * Versions, mode, level, end reason and final route stay on `learning_session_missions`. Scores are
 * half-point integers; `area_scores` holds per-area earned/max for goal and the four language areas.
 */
export const learningMissionResults = pgTable("learning_mission_results", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  evaluationStatus: text("evaluation_status").notNull(), areaScores: jsonb("area_scores"),
  totalEarnedHalf: integer("total_earned_half"), totalMaxHalf: integer("total_max_half"), meetsThreshold: boolean("meets_threshold"), evaluatedAt: time("evaluated_at"),
  /** Local YYYY-MM-DD credited as an achievement day, written once with the evaluation and never recomputed (DEC-095). */
  achievementDate: text("achievement_date"),
}, t => [
  foreignKey({ name: "learning_mission_result_session_owner", columns: [t.learningSessionId, t.userId], foreignColumns: [learningSessions.learningSessionId, learningSessions.userId] }).onDelete("cascade"),
  index("learning_mission_result_user").on(t.userId),
  check("learning_mission_result_status", sql`${t.evaluationStatus} in ('pending', 'ready', 'skipped', 'unavailable')`),
  check("learning_mission_result_scores", sql`(${t.evaluationStatus} = 'ready') = (${t.areaScores} is not null and ${t.totalEarnedHalf} is not null and ${t.totalMaxHalf} is not null and ${t.evaluatedAt} is not null)`),
  check("learning_mission_result_range", sql`${t.totalEarnedHalf} is null or (${t.totalEarnedHalf} >= 0 and ${t.totalEarnedHalf} <= ${t.totalMaxHalf})`),
  check("learning_mission_result_threshold", sql`${t.meetsThreshold} is null or (${t.evaluationStatus} = 'ready' and ${t.totalMaxHalf} > 0)`),
  check("learning_mission_result_achievement", sql`${t.achievementDate} is null or (${t.meetsThreshold} is true and ${t.achievementDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`),
  index("learning_mission_result_user_achievement").on(t.userId, t.achievementDate).where(sql`${t.achievementDate} is not null`),
]);
/** Per-criterion verdicts, reasons and short verified quotes; expire with the note (DEC-088). */
export const learningMissionResultDetails = pgTable("learning_mission_result_details", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  judgements: jsonb("judgements").notNull(), detailRetentionExpiresAt: time("detail_retention_expires_at").notNull(),
}, t => [
  foreignKey({ name: "learning_mission_detail_session_owner", columns: [t.learningSessionId, t.userId], foreignColumns: [learningSessions.learningSessionId, learningSessions.userId] }).onDelete("cascade"),
  index("learning_mission_detail_user_expiry").on(t.userId, t.detailRetentionExpiresAt),
]);
/**
 * Mission count ledger (DEC-069, DEC-096). One row per mission start: held at start, then confirmed
 * when a learner utterance was confirmed by the end, or released otherwise. Kept apart from the
 * learning-record lifetime (no session FK), so expiring records never restores a count; removed with the account.
 */
export const missionUsageHolds = pgTable("mission_usage_holds", {
  learningSessionId: uuid("learning_session_id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  usageStatus: text("usage_status").notNull().default("held"), heldAt: time("held_at").notNull(), settledAt: time("settled_at"),
}, t => [
  index("mission_usage_user_status").on(t.userId, t.usageStatus),
  // One open session per account means at most one unsettled hold.
  uniqueIndex("mission_usage_one_held").on(t.userId).where(sql`${t.usageStatus} = 'held'`),
  check("mission_usage_status", sql`${t.usageStatus} in ('held', 'confirmed', 'released')`),
  check("mission_usage_settled", sql`(${t.usageStatus} = 'held') = (${t.settledAt} is null)`),
]);
