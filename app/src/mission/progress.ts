// Mission progress stored inside the conversation snapshot (MISSIONS "진행 상태"). Browser-safe:
// only route IDs and turn IDs, never partner knowledge or rubric content. Semantic checks
// (accept after proposal, played staff turn) belong to the realtime validator, not storage.
import type { Turn } from "../learning/types";

export const MISSION_ROUTE_EVENT_KINDS = ["proposed", "user_accepted", "staff_confirmed", "route_changed"] as const;
export type MissionRouteEventKind = typeof MISSION_ROUTE_EVENT_KINDS[number];

export interface MissionRouteEvent {
  eventId: string;
  kind: MissionRouteEventKind;
  /** For `route_changed`, the route the conversation moved to. */
  routeId: string;
  evidenceTurnId: string;
}

export interface MissionProgress {
  routeEvents: readonly MissionRouteEvent[];
  /** Consecutive no-progress candidates (real mode only). Reset to 0 on resume. */
  noProgress: { count: number; evidenceTurnIds: readonly string[] };
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ROUTE_ID = /^[a-z0-9-]{1,64}$/;
export const MISSION_PROGRESS_LIMITS = { routeEvents: 200, noProgress: 50 } as const;

export const isEmptyMissionProgress = (progress: MissionProgress | undefined) =>
  !progress || (!progress.routeEvents.length && !progress.noProgress.count);

/**
 * Structural validation against the turns of the same snapshot. Returns undefined for an empty
 * progress so empty values are never serialized (legacy JSON/hash compatibility). Throws on invalid input.
 */
export function validateMissionProgress(input: unknown, turns: readonly Turn[]): MissionProgress | undefined {
  if (input === undefined) return undefined;
  const fail = () => { throw new Error("INVALID_MISSION_PROGRESS"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const value = input as { routeEvents?: unknown; noProgress?: unknown };
  const roles = new Map(turns.map(t => [t.turnId, t.role]));
  if (!Array.isArray(value.routeEvents) || value.routeEvents.length > MISSION_PROGRESS_LIMITS.routeEvents) fail();
  const eventIds = new Set<string>();
  const routeEvents = (value.routeEvents as unknown[]).map(raw => {
    const e = raw as Partial<MissionRouteEvent> | null;
    if (!e || typeof e.eventId !== "string" || !ID.test(e.eventId) || eventIds.has(e.eventId) || !MISSION_ROUTE_EVENT_KINDS.includes(e.kind as MissionRouteEventKind) ||
      typeof e.routeId !== "string" || !ROUTE_ID.test(e.routeId) || typeof e.evidenceTurnId !== "string" || !roles.has(e.evidenceTurnId)) fail();
    // Acceptance must be the learner's own words; confirmation must be a staff (assistant) turn.
    if (e!.kind === "user_accepted" && roles.get(e!.evidenceTurnId!) !== "user") fail();
    if (e!.kind === "staff_confirmed" && roles.get(e!.evidenceTurnId!) !== "assistant") fail();
    eventIds.add(e!.eventId!);
    return { eventId: e!.eventId!, kind: e!.kind!, routeId: e!.routeId!, evidenceTurnId: e!.evidenceTurnId! };
  });
  const np = value.noProgress as { count?: unknown; evidenceTurnIds?: unknown } | null;
  if (!np || typeof np !== "object" || !Number.isSafeInteger(np.count) || (np.count as number) < 0 || (np.count as number) > MISSION_PROGRESS_LIMITS.noProgress ||
    !Array.isArray(np.evidenceTurnIds) || np.evidenceTurnIds.length !== np.count || new Set(np.evidenceTurnIds).size !== np.evidenceTurnIds.length ||
    np.evidenceTurnIds.some(id => typeof id !== "string" || !roles.has(id))) fail();
  const progress: MissionProgress = { routeEvents, noProgress: { count: np!.count as number, evidenceTurnIds: [...(np!.evidenceTurnIds as string[])] } };
  return isEmptyMissionProgress(progress) ? undefined : progress;
}

/** Route IDs referenced by a progress value, for checking against the session's fixed definition. */
export const missionProgressRouteIds = (progress: MissionProgress | undefined) => new Set(progress?.routeEvents.map(e => e.routeId) ?? []);

/** Resume view: route events are kept, the no-progress streak restarts (MISSIONS 진행 상태). */
export function resumeMissionProgress(progress: MissionProgress | undefined): MissionProgress | undefined {
  if (!progress) return undefined;
  const resumed = { routeEvents: progress.routeEvents, noProgress: { count: 0, evidenceTurnIds: [] } };
  return isEmptyMissionProgress(resumed) ? undefined : resumed;
}
