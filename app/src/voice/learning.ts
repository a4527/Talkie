import { boundRecords } from "../learning/buffer";
import type { ConversationSnapshot, Correction, Turn } from "../learning/types";
import type { VoiceEvent } from "./port";

export type VoiceLearningResult = {
  original: string; learningState: "conversation" | "retry";
  replacement?: string; explanation?: string; retryOutcome?: "success" | "failure";
};
export function parseVoiceLearningResult(value: unknown): VoiceLearningResult | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (typeof v.original !== "string" || !v.original.trim() || v.original.length > 6000 || !["conversation", "retry"].includes(String(v.learningState))) return;
  if (v.replacement !== undefined && (typeof v.replacement !== "string" || !v.replacement.trim() || v.replacement.length > 1200)) return;
  if (v.explanation !== undefined && (typeof v.explanation !== "string" || v.explanation.length > 2000)) return;
  if (v.retryOutcome !== undefined && !["success", "failure"].includes(String(v.retryOutcome))) return;
  return { original: v.original, learningState: v.learningState as VoiceLearningResult["learningState"],
    replacement: v.replacement as string | undefined, explanation: v.explanation as string | undefined,
    retryOutcome: v.retryOutcome as VoiceLearningResult["retryOutcome"] };
}

/** Only complete input and fully played output enter the immutable storage window. */
export class VoiceLearningRecords {
  private snapshot: ConversationSnapshot;
  private acknowledged = new Set<string>();
  private cancelled = new Set<string>();
  private pending = new Map<string, { role: Turn["role"]; text: string; complete?: boolean; played?: boolean; inputTurnId?: string; result?: VoiceLearningResult }>();
  constructor(snapshot: ConversationSnapshot = { turns: [], corrections: [], learningState: "conversation" }) {
    const bounded = boundRecords(snapshot.turns, snapshot.corrections, 128 * 1024);
    this.snapshot = { ...snapshot, turns: bounded.turns, corrections: bounded.corrections };
    this.acknowledge(this.snapshot);
  }
  getSnapshot() { return this.snapshot; }
  acknowledge(snapshot: ConversationSnapshot) { for (const turn of snapshot.turns) this.acknowledged.add(turn.requestId); }
  apply(event: VoiceEvent | { type: "played"; turnId: string }) {
    if (!("turnId" in event)) return;
    if (this.cancelled.has(event.turnId)) return;
    if (this.snapshot.turns.some(t => t.turnId === event.turnId)) return;
    if (event.type === "interrupted") { this.pending.delete(event.turnId); this.cancelled.add(event.turnId); return; }
    const entry = this.pending.get(event.turnId) ?? { role: "assistant" as const, text: "" };
    if (event.type === "transcript") { entry.role = event.role; entry.text = (entry.text + event.text).slice(0, 6000); }
    if (event.type === "input-complete") { entry.role = "user"; entry.complete = true; }
    if (event.type === "response-complete") { entry.complete = true; if (event.inputTurnId) entry.inputTurnId = event.inputTurnId; }
    if (event.type === "played") entry.played = true;
    if (event.type === "learning-cancelled") { entry.result = undefined; entry.inputTurnId = undefined; }
    if (event.type === "learning-result") { entry.inputTurnId = event.inputTurnId; entry.result = event.result; }
    this.pending.set(event.turnId, entry);
    while (this.pending.size > 100) this.pending.delete(this.pending.keys().next().value!);
    if (!entry.text.trim() || !entry.complete || (entry.role === "assistant" && !entry.played)) return;
    const turn: Turn = { turnId: event.turnId, requestId: entry.role === "assistant" ? (entry.inputTurnId ?? event.turnId) : event.turnId, role: entry.role, text: entry.text };
    let corrections = [...this.snapshot.corrections], learningState = this.snapshot.learningState;
    const result = entry.result, source = this.snapshot.turns.find(t => t.turnId === entry.inputTurnId && t.role === "user");
    if (result && source && source.text.trim() === result.original.trim()) {
      // App verifies evidence; language judgement remains the provider's responsibility.
      const validCorrection = result.replacement && turn.text.includes(result.replacement);
      if (!result.replacement || validCorrection) {
        learningState = result.learningState;
        if (result.retryOutcome && corrections.length) {
          const last = corrections.at(-1)!;
          if (last.sourceTurnId !== source.turnId && !last.attempts.some(a => a.turnId === source.turnId)) corrections = [...corrections.slice(0, -1), { ...last, attempts: [...last.attempts, { turnId: source.turnId, outcome: result.retryOutcome }] }];
        }
        if (validCorrection) corrections.push({ correctionId: turn.turnId, sourceTurnId: source.turnId, deliveredTurnId: turn.turnId,
          replacement: result.replacement!, explanation: result.explanation ?? "", attempts: [] } satisfies Correction);
      }
    }
    const bounded = boundRecords([...this.snapshot.turns, turn], corrections, 128 * 1024);
    this.snapshot = { turns: bounded.turns, corrections: bounded.corrections, learningState, hasConversationGaps: this.snapshot.hasConversationGaps === true || bounded.removed.some(id => !this.acknowledged.has(id)) };
    const live = new Set(this.snapshot.turns.map(t => t.requestId));
    this.acknowledged = new Set([...this.acknowledged].filter(id => live.has(id)));
    this.pending.delete(event.turnId);
    // Unconfirmed provider fragments are volatile and bounded separately.
    while (this.pending.size > 100) this.pending.delete(this.pending.keys().next().value!);
  }
}
