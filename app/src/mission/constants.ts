// Browser-safe mission constants. Kept apart from definitions.ts so screens can import them
// without bundling partner knowledge or rubric evidence text.

export const MISSION_MODES = ["practice", "real"] as const;
export const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C"] as const;
export const LANGUAGE_AREAS = ["grammar", "vocabulary", "organization", "interaction"] as const;
export type MissionMode = typeof MISSION_MODES[number];
export type LanguageLevel = typeof LANGUAGE_LEVELS[number];
export type LanguageArea = typeof LANGUAGE_AREAS[number];
export type ScoreArea = "goal" | LanguageArea;

export const GOAL_TOTAL_POINTS = 60;
export const LANGUAGE_TOTAL_POINTS = 40;
export const LANGUAGE_AREA_POINTS = 10;

export const MISSION_END_REASONS = ["goal_completed", "no_progress_failed", "user_ended", "resume_expired"] as const;
export type MissionEndReason = typeof MISSION_END_REASONS[number];
export const EVALUATION_STATUSES = ["pending", "ready", "skipped", "unavailable"] as const;
export type EvaluationStatus = typeof EVALUATION_STATUSES[number];
