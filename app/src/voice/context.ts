import type { ConversationSnapshot } from "../learning/types";

/** Same bounded, confirmed context for Live and cascade; no pending/generated output. */
export function selectVoiceContext(context: ConversationSnapshot): ConversationSnapshot {
  const turns: Array<ConversationSnapshot["turns"][number]> = [];
  let bytes = 0;
  for (const turn of [...context.turns].reverse().slice(0, 20)) {
    bytes += new TextEncoder().encode(turn.text).length;
    if (bytes > 20 * 1024) break;
    turns.unshift({ ...turn });
  }
  return { turns, learningState: context.learningState,
    corrections: context.corrections.filter(c => turns.some(t => t.turnId === c.sourceTurnId) && turns.some(t => t.turnId === c.deliveredTurnId)).slice(-3)
      .map(c => ({ ...c, explanation: c.explanation.slice(0, 500), attempts: c.attempts.filter(a => turns.some(t => t.turnId === a.turnId)).slice(-3).map(a => ({ ...a })) })),
    hasConversationGaps: context.hasConversationGaps === true };
}
