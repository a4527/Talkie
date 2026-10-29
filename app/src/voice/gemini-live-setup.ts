import { createTutorInstruction } from "./tutor-prompt";

// Shared wire configuration for token constraints and the initial setup message.
export const GEMINI_LIVE_MODEL = "models/gemini-3.8-live";
export const VOICE_TEST_SECONDS = 180;
export function createGeminiLiveSetup(learning = false) {
  return {
    model: GEMINI_LIVE_MODEL,
    generationConfig: { responseModalities: ["AUDIO"], maxOutputTokens: 1024,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    inputAudioTranscription: { languageCodes: ["en-US", "ko-KR"], mode: "VERBATIM" }, outputAudioTranscription: {},
    ...(learning ? { tools: [{ functionDeclarations: [{ name: "record_learning_result", description: "Record the learning state for your next spoken response. Call BEFORE speaking. Use exact input transcript as original. Include a correction only if you will speak the exact replacement. Call for every learner utterance, including retry attempts. When inviting a retry set learningState to retry. When evaluating an actual retry include retryOutcome: success with conversation, or failure with retry. Omit retryOutcome for unclear input or a change of subject. A retry outcome describes only the latest retry, never mastery.", parameters: {
      type: "OBJECT", properties: { original: { type: "STRING" }, learningState: { type: "STRING", enum: ["conversation", "retry"] }, replacement: { type: "STRING" }, explanation: { type: "STRING" }, retryOutcome: { type: "STRING", enum: ["success", "failure"] } }, required: ["original", "learningState"],
    } }] }] } : {}),
    systemInstruction: { parts: [{ text: createTutorInstruction(learning) }] },
  };
}
