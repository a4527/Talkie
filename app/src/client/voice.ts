export async function requestVoiceConnectionToken(signal: AbortSignal) {
  const response = await fetch("/api/voice/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testOnly: true }), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as { voiceConnectionToken: string; testDurationSeconds: number };
}
