import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "./config";
import { missionUsageHolds } from "./db/records-schema";
import type { RecordsTransaction } from "./db";

/**
 * Local test allowance until the trial amount, period and renewal are decided (PRD 9.2, DEC-096).
 * Not a product value: `TALKIE_MISSION_ALLOWANCE` overrides it for tests and demos.
 */
export const DEFAULT_MISSION_ALLOWANCE = 10;

export function missionAllowanceLimit() {
  const raw = process.env.TALKIE_MISSION_ALLOWANCE;
  if (raw === undefined || raw === "") return DEFAULT_MISSION_ALLOWANCE;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new AppError("MISSION_ALLOWANCE_MISCONFIGURED", 503);
  return value;
}

/** Held and confirmed starts both use a count; released ones do not. */
export async function missionAllowance(tx: RecordsTransaction, userId: string) {
  const limit = missionAllowanceLimit();
  const [row] = await tx.select({ used: sql<number>`count(*)::int` }).from(missionUsageHolds)
    .where(and(eq(missionUsageHolds.userId, userId), inArray(missionUsageHolds.usageStatus, ["held", "confirmed"])));
  return { limit, remaining: Math.max(0, limit - (row?.used ?? 0)) };
}

/**
 * Holds one count for a new mission start inside the start transaction. The caller has already
 * ruled out an open session, and the partial unique index keeps a single unsettled hold per account,
 * so concurrent starts cannot both pass the remaining check.
 */
export async function holdMissionUsage(tx: RecordsTransaction, userId: string, learningSessionId: string, now: Date) {
  if ((await missionAllowance(tx, userId)).remaining < 1) throw new AppError("MISSION_ALLOWANCE_EXHAUSTED", 403);
  await tx.insert(missionUsageHolds).values({ learningSessionId, userId, heldAt: now });
}

/** Settles the hold once when the mission end is recorded: a confirmed learner utterance confirms it, otherwise it is released. */
export async function settleMissionUsage(tx: RecordsTransaction, learningSessionId: string, learnerSpoke: boolean, now: Date) {
  await tx.update(missionUsageHolds).set({ usageStatus: learnerSpoke ? "confirmed" : "released", settledAt: now })
    .where(and(eq(missionUsageHolds.learningSessionId, learningSessionId), eq(missionUsageHolds.usageStatus, "held")));
}
