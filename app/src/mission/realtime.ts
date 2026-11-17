// Realtime mission state (MISSIONS "실시간 도구"). The same realtime AI reports route events and
// no-progress candidates with a tool call; this module is the app-side validator shared by the
// Gemini Live and cascade paths. Browser-safe: route IDs and turn IDs only, never partner knowledge.
import type { Turn } from "../learning/types";
import type { MissionMode } from "./definitions";
import { MISSION_PROGRESS_LIMITS, MISSION_ROUTE_EVENT_KINDS, type MissionProgress, type MissionRouteEvent, type MissionRouteEventKind } from "./progress";

export const MISSION_STATE_TOOL_NAME = "report_mission_state";
/** Test value only (PRD 4.2.2); the operational threshold is undecided. */
export const DEFAULT_NO_PROGRESS_THRESHOLD = 3;

export const MISSION_PROGRESS_SIGNALS = ["progress", "no_progress", "excluded"] as const;
export type MissionProgressSignal = typeof MISSION_PROGRESS_SIGNALS[number];
export interface MissionStateReport {
  routeEvents: { kind: MissionRouteEventKind; routeId: string }[];
  /** Real mode only; ignored in practice. */
  progress?: MissionProgressSignal;
}
/** Sent to the realtime AI when the reply it is about to speak ends a real mission without progress. */
export const MISSION_NO_PROGRESS_CLOSING = "The app is ending this mission now because the conversation is not moving forward. Stay in role and say one short, polite closing line, for example that the customer can come back to the counter any time. Do not ask a question, give a hint or correction, or mention scores or failure.";
export type MissionEnding = "no_progress_failed";
/** Lets a provider adapter ask, before speaking, whether a reply will end the mission (see MissionTracker.previewEnding). */
export type MissionEndingAdvisor = (inputTurnId: string, report: MissionStateReport) => MissionEnding | undefined;
export type MissionOutcome = { reason: "goal_completed"; routeId: string } | { reason: "no_progress_failed" };
export interface MissionTrackerConfig { missionMode: MissionMode; routeIds: readonly string[]; noProgressThreshold?: number }

// Learner-side events are evidenced by the learner turn being answered; staff-side events by the reply itself.
const USER_EVIDENCE: readonly MissionRouteEventKind[] = ["user_accepted", "route_changed"];

export function createMissionStateToolDeclaration(missionMode: MissionMode) {
  return {
    name: MISSION_STATE_TOOL_NAME,
    description: "Report mission state for the reply you are about to speak. Call BEFORE speaking, once per learner utterance. " +
      "routeEvents: proposed = your reply offers a concrete allowed resolution with its conditions; user_accepted = the learner's latest utterance accepts a concrete resolution you offered; " +
      "staff_confirmed = your reply confirms a resolution the learner accepted; route_changed = the learner's latest utterance switches to another allowed resolution (routeId is the new one). " +
      (missionMode === "real" ? "progress: progress when the learner's latest utterance moves the situation forward, no_progress when they had a chance to answer your relevant question or offer and did not, excluded when the input was unclear, possibly misrecognized, or followed your own repeated question." : "Omit progress."),
    parameters: {
      type: "OBJECT",
      properties: {
        routeEvents: { type: "ARRAY", items: { type: "OBJECT", properties: {
          kind: { type: "STRING", enum: [...MISSION_ROUTE_EVENT_KINDS] }, routeId: { type: "STRING" } }, required: ["kind", "routeId"] } },
        ...(missionMode === "real" ? { progress: { type: "STRING", enum: [...MISSION_PROGRESS_SIGNALS] } } : {}),
      },
    },
  };
}

/**
 * Response schema for the cascade text path, which has no tool call: the same report shape with the
 * allowed values enforced by the provider (route IDs from the fixed definition, progress required in real mode).
 */
export function createMissionReportSchema(missionMode: MissionMode, routeIds: readonly string[]) {
  return {
    type: "OBJECT",
    properties: {
      routeEvents: { type: "ARRAY", maxItems: 4, items: { type: "OBJECT", properties: {
        kind: { type: "STRING", enum: [...MISSION_ROUTE_EVENT_KINDS] }, routeId: { type: "STRING", enum: [...routeIds] } }, required: ["kind", "routeId"] } },
      ...(missionMode === "real" ? { progress: { type: "STRING", enum: [...MISSION_PROGRESS_SIGNALS] } } : {}),
    },
    required: missionMode === "real" ? ["routeEvents", "progress"] : ["routeEvents"],
  };
}

/** Strict structural parser for provider output. Undefined means the whole report is ignored. */
export function parseMissionStateReport(value: unknown): MissionStateReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const raw = v.routeEvents ?? [];
  if (!Array.isArray(raw) || raw.length > 4) return;
  const kinds = new Set<string>();
  const routeEvents: MissionStateReport["routeEvents"] = [];
  for (const item of raw) {
    const e = item as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || !MISSION_ROUTE_EVENT_KINDS.includes(e.kind as MissionRouteEventKind) || kinds.has(e.kind as string) ||
      typeof e.routeId !== "string" || !/^[a-z0-9-]{1,64}$/.test(e.routeId)) return;
    kinds.add(e.kind as string);
    routeEvents.push({ kind: e.kind as MissionRouteEventKind, routeId: e.routeId });
  }
  if (v.progress !== undefined && !MISSION_PROGRESS_SIGNALS.includes(v.progress as MissionProgressSignal)) return;
  return { routeEvents, ...(v.progress !== undefined ? { progress: v.progress as MissionProgressSignal } : {}) };
}

/**
 * A route is complete when, for the same route, a proposal precedes a learner acceptance, which
 * precedes a staff confirmation, with no switch to another route between acceptance and confirmation.
 * `order` gives the conversation position of an evidence turn; events with unknown positions never count.
 */
export function findCompletedRoute(events: readonly MissionRouteEvent[], order: (turnId: string) => number | undefined): string | undefined {
  const at = (e: MissionRouteEvent) => order(e.evidenceTurnId);
  const positioned = events.filter(e => at(e) !== undefined).sort((a, b) => at(a)! - at(b)!);
  for (const confirmed of positioned.filter(e => e.kind === "staff_confirmed")) {
    const c = at(confirmed)!, route = confirmed.routeId;
    const accepted = positioned.filter(e => e.kind === "user_accepted" && e.routeId === route && at(e)! < c);
    const ok = accepted.some(a => {
      const ai = at(a)!;
      return positioned.some(p => p.kind === "proposed" && p.routeId === route && at(p)! < ai) &&
        !positioned.some(r => r.kind === "route_changed" && r.routeId !== route && at(r)! > ai && at(r)! <= c);
    });
    if (ok) return route;
  }
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Applies reports only when their reply has been played (callers invoke `commit` at that point).
 * Keeps every committed event in memory for completion checks, and exposes a snapshot view
 * bounded to the turns of the current storage window (the server merges events by ID).
 */
export class MissionTracker {
  private events: MissionRouteEvent[];
  private noProgress: { count: number; evidenceTurnIds: string[] } = { count: 0, evidenceTurnIds: [] };
  private sequence: Turn[] = [];
  private positions = new Map<string, number>();
  private outcome?: MissionOutcome;
  private routes: Set<string>;
  private threshold: number;
  constructor(private config: MissionTrackerConfig, restored?: { turns: readonly Turn[]; progress?: MissionProgress }) {
    this.routes = new Set(config.routeIds);
    this.threshold = config.noProgressThreshold ?? DEFAULT_NO_PROGRESS_THRESHOLD;
    for (const turn of restored?.turns ?? []) this.confirmTurn(turn);
    this.events = (restored?.progress?.routeEvents ?? []).filter(e => this.routes.has(e.routeId)).map(e => ({ ...e }));
    // Resumes never continue a streak (PRD 4.2.2); a completed route stays completed.
    const route = findCompletedRoute(this.events, id => this.positions.get(id));
    if (route) this.outcome = { reason: "goal_completed", routeId: route };
  }
  getOutcome() { return this.outcome; }
  /** Records the conversation position of every confirmed turn, in confirmation order. */
  confirmTurn(turn: Turn) {
    if (this.positions.has(turn.turnId)) return;
    this.positions.set(turn.turnId, this.sequence.length);
    this.sequence.push(turn);
  }
  /**
   * Commits a report attached to a played staff reply. `inputTurnId` is the confirmed learner turn it answered.
   * Invalid route events are dropped individually; a missing report breaks the no-progress streak.
   */
  commit(replyTurnId: string, inputTurnId: string | undefined, report: MissionStateReport | undefined) {
    if (this.outcome) return this.outcome;
    const reply = this.turn(replyTurnId), input = inputTurnId ? this.turn(inputTurnId) : undefined;
    if (!reply || reply.role !== "assistant") return;
    const learner = input?.role === "user" && this.positions.get(input.turnId)! < this.positions.get(reply.turnId)! ? input : undefined;
    let routeProgress = false;
    for (const e of report?.routeEvents ?? []) {
      const evidence = USER_EVIDENCE.includes(e.kind) ? learner : reply;
      if (!evidence || !this.routes.has(e.routeId) || this.events.length >= MISSION_PROGRESS_LIMITS.routeEvents) continue;
      const eventId = `${e.kind}-${evidence.turnId}`;
      if (!EVENT_ID.test(eventId) || this.events.some(x => x.eventId === eventId)) continue;
      this.events.push({ eventId, kind: e.kind, routeId: e.routeId, evidenceTurnId: evidence.turnId });
      if (USER_EVIDENCE.includes(e.kind)) routeProgress = true;
    }
    const route = findCompletedRoute(this.events, id => this.positions.get(id));
    if (route) return this.outcome = { reason: "goal_completed", routeId: route }; // Completion wins over failure.
    if (this.config.missionMode !== "real") return;
    // A candidate counts only when the learner answered a played staff turn (an actual chance to respond).
    const answeredStaff = learner && this.sequence[this.positions.get(learner.turnId)! - 1]?.role === "assistant";
    if (report?.progress === "no_progress" && !routeProgress && answeredStaff && !this.noProgress.evidenceTurnIds.includes(learner.turnId) &&
      this.noProgress.count < MISSION_PROGRESS_LIMITS.noProgress) {
      this.noProgress = { count: this.noProgress.count + 1, evidenceTurnIds: [...this.noProgress.evidenceTurnIds, learner.turnId] };
      if (this.noProgress.count >= this.threshold) return this.outcome = { reason: "no_progress_failed" };
    } else this.noProgress = { count: 0, evidenceTurnIds: [] };
  }
  /**
   * Before the reply is spoken: would committing this report end a real mission without progress?
   * Mirrors `commit` with the learner turn either confirmed or about to be confirmed next. The final
   * outcome is still decided only by `commit` after playback; a completion in the same report wins.
   */
  previewEnding(inputTurnId: string, report: MissionStateReport): MissionEnding | undefined {
    if (this.outcome || this.config.missionMode !== "real" || report.progress !== "no_progress") return;
    if (report.routeEvents.some(e => USER_EVIDENCE.includes(e.kind) && this.routes.has(e.routeId))) return;
    const position = this.positions.get(inputTurnId);
    if (position !== undefined && this.sequence[position].role !== "user") return;
    const before = position === undefined ? this.sequence.at(-1) : this.sequence[position - 1];
    if (before?.role !== "assistant" || this.noProgress.evidenceTurnIds.includes(inputTurnId)) return;
    const reply = "\u0000reply", staff = report.routeEvents.filter(e => !USER_EVIDENCE.includes(e.kind) && this.routes.has(e.routeId))
      .map(e => ({ eventId: `${e.kind}-preview`, kind: e.kind, routeId: e.routeId, evidenceTurnId: reply }));
    if (findCompletedRoute([...this.events, ...staff], id => id === reply ? this.sequence.length + 1 : this.positions.get(id))) return;
    return this.noProgress.count + 1 >= this.threshold ? "no_progress_failed" : undefined;
  }
  /** Progress restricted to evidence present in `turns` (the bounded storage window); undefined when empty. */
  snapshot(turns: readonly Turn[]): MissionProgress | undefined {
    const ids = new Set(turns.map(t => t.turnId));
    const routeEvents = this.events.filter(e => ids.has(e.evidenceTurnId)).map(e => ({ ...e }));
    const evidenceTurnIds = this.noProgress.evidenceTurnIds.filter(id => ids.has(id));
    if (!routeEvents.length && !evidenceTurnIds.length) return undefined;
    return { routeEvents, noProgress: { count: evidenceTurnIds.length, evidenceTurnIds } };
  }
  private turn(turnId: string) { const p = this.positions.get(turnId); return p === undefined ? undefined : this.sequence[p]; }
}
