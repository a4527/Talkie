import type { VoiceEvent } from "./port";
export type VoiceTranscriptTurn = { turnId: string; role: "user" | "assistant"; text: string; delivery: "unconfirmed" | "played" | "interrupted" };
/** Generated transcripts are not evidence. Only the audio runtime can confirm playback completion. */
export function updateVoiceTranscriptTurns(records: readonly VoiceTranscriptTurn[], event: VoiceEvent | { type: "played"; turnId: string }): VoiceTranscriptTurn[] {
  if (event.type === "transcript") {
    const found = records.find(record => record.turnId === event.turnId);
    if (found?.delivery === "interrupted") return [...records];
    if (!found) return [...records, { turnId: event.turnId, role: event.role, text: event.text.slice(0, 6000), delivery: "unconfirmed" as const }].slice(-100);
    return records.map(record => record.turnId === event.turnId ? { ...record, text: (record.text + event.text).slice(0, 6000) } : record);
  }
  if (event.type === "played" || event.type === "interrupted") {
    return records.map(record => record.turnId === event.turnId && record.delivery !== "interrupted" && !(event.type === "interrupted" && record.delivery === "played")
      ? { ...record, delivery: event.type === "played" ? "played" : "interrupted" } : record);
  }
  return [...records];
}
