import type { ConversationSnapshot } from "../learning/types";
export async function requestLearningAction(data: Record<string, unknown>) {
  const response = await fetch("/api/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
export type StoredVoiceSession = { learningSessionId: string; learningConnectionToken: string; confirmedSaveSequenceNumber: number; conversationSnapshot: ConversationSnapshot };
/** Keep the same sequence/body when retrying a failed or unacknowledged save. */
export class VoiceLearningStore {
  private sequence: number;
  private savedKey: string;
  private pending?: { saveSequenceNumber: number; conversationSnapshot: ConversationSnapshot; key: string };
  private queue = Promise.resolve();
  private ending = false;
  constructor(readonly session: StoredVoiceSession, private request = requestLearningAction) {
    this.sequence = session.confirmedSaveSequenceNumber;
    this.savedKey = JSON.stringify(session.conversationSnapshot);
  }
  sync(snapshot: ConversationSnapshot, action?: "pause" | "end") {
    const work = this.queue.catch(() => {}).then(async () => {
      const base = { learningSessionId: this.session.learningSessionId, learningConnectionToken: this.session.learningConnectionToken };
      if (action === "end" && !this.ending) { await this.request({ action: "end", ...base }); this.ending = true; }
      for (;;) {
        const key = JSON.stringify(snapshot);
        if (!this.pending && key !== this.savedKey) this.pending = { saveSequenceNumber: this.sequence + 1, conversationSnapshot: snapshot, key };
        if (!this.pending) break;
        const pending = this.pending;
        await this.request({ action: "save", ...base, saveSequenceNumber: pending.saveSequenceNumber, conversationSnapshot: pending.conversationSnapshot });
        this.sequence = pending.saveSequenceNumber; this.savedKey = pending.key; this.pending = undefined;
      }
      if (action === "end") await this.request({ action: "note", learningSessionId: this.session.learningSessionId });
      else await this.request({ action: action ?? "heartbeat", ...base });
    });
    this.queue = work;
    return work;
  }
}
