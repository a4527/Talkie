export const cascadeSttChoices = [{ value: "soniox", label: "Soniox" }] as const;
export const cascadeLlmChoices = [{ value: "gemini-flash-lite", label: "Gemini Flash-Lite" }] as const;
export const cascadeTtsChoices = [
  { value: "gemini-flash-lite-tts", label: "Gemini Flash-Lite TTS" },
  { value: "google-cloud-standard", label: "Google Cloud Standard" },
] as const;

export type CascadeSelection = {
  stt: typeof cascadeSttChoices[number]["value"];
  llm: typeof cascadeLlmChoices[number]["value"];
  tts: typeof cascadeTtsChoices[number]["value"];
};
export const defaultCascadeSelection: CascadeSelection = { stt: "soniox", llm: "gemini-flash-lite", tts: "gemini-flash-lite-tts" };

export function parseCascadeSelection(value: unknown): CascadeSelection | undefined {
  if (!value || typeof value !== "object") return;
  const selection = value as Record<string, unknown>;
  if (selection.stt !== "soniox" || selection.llm !== "gemini-flash-lite") return;
  if (selection.tts !== "gemini-flash-lite-tts" && selection.tts !== "google-cloud-standard") return;
  return { stt: selection.stt, llm: selection.llm, tts: selection.tts };
}
