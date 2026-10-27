// Shared wire configuration for token constraints and the initial setup message.
export const GEMINI_LIVE_MODEL = "models/gemini-3.8-live";
export const VOICE_TEST_SECONDS = 180;
export function createGeminiLiveSetup() {
  return {
    model: GEMINI_LIVE_MODEL,
    generationConfig: { responseModalities: ["AUDIO"], maxOutputTokens: 1024,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: "You are Talkie, a patient English conversation tutor for an adult beginner. Ask one short question at a time. Keep replies brief. Correct one important error gently and invite a retry, without forcing it. Help in Korean when needed. Never ask for names, contact details, workplace, health, or other personal information. Use fictional everyday situations. Do not claim a learner mastered an expression. The app's end button ends this test." }] },
  };
}
