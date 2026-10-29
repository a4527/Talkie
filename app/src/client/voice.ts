import type { PriorLearningContext } from "../voice/prior-learning";
export async function requestVoiceConnectionToken(signal: AbortSignal, session?: { learningSessionId: string; learningConnectionToken: string }) {
  const response = await fetch("/api/voice/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testOnly: true, ...(session ? { learningSessionId: session.learningSessionId, learningConnectionToken: session.learningConnectionToken } : {}) }), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { voiceConnectionToken: string; testDurationSeconds: number; priorLearningContext?: PriorLearningContext };
}
