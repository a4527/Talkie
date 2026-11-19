/**
 * Achievement-day rules (PRD 4.5, DEC-095). A mission credits the local calendar date of its end
 * time in the IANA time zone fixed at start. The date is written once with the evaluation and is
 * never recomputed, so a later rubric or prompt change does not move or remove an earned day.
 */
export const DEFAULT_MISSION_TIME_ZONE = "Asia/Seoul";

/** Returns a canonical IANA zone name, or undefined when the runtime does not know it. */
export function parseTimeZone(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(input)) return;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: input }).resolvedOptions().timeZone; } catch { return; }
}

/** YYYY-MM-DD of `instant` as seen on a wall clock in `timeZone`. */
export function localDateIn(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The credited date, or null. Only a confirmed evaluation at or above 80% counts; a real-mode failure
 * still counts, while a mission auto-closed by resume expiry never does. An undeterminable final
 * resolution/agreement criterion also blocks the day: the resolution was not confirmed (DEC-097).
 */
export function achievementDateFor(input: { meetsThreshold: boolean | null; missionEndReason: string | null; learningSessionEndedAt: Date; missionTimeZone: string; resolutionUnconfirmed: boolean }) {
  if (input.meetsThreshold !== true || input.missionEndReason === "resume_expired" || input.resolutionUnconfirmed) return null;
  return localDateIn(input.learningSessionEndedAt, parseTimeZone(input.missionTimeZone) ?? DEFAULT_MISSION_TIME_ZONE);
}

/** True when any criterion marked `resolution` was judged undeterminable (or is missing). */
export function resolutionUnconfirmed(judgements: readonly { criterionId: string; verdict: string }[], goalCriteria: readonly { criterionId: string; resolution?: true }[]) {
  const verdicts = new Map(judgements.map(j => [j.criterionId, j.verdict]));
  return goalCriteria.some(c => c.resolution && (verdicts.get(c.criterionId) ?? "undeterminable") === "undeterminable");
}
