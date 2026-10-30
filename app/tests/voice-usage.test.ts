import { expect, it } from "vitest";
import { observeGeminiUsage } from "../src/server/voice-usage";

it("keeps only bounded token counts and modalities from a provider response", () => {
  const observed = observeGeminiUsage("text-model", {
    usageMetadata: {
      promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 8 }],
      unrelatedPrivateValue: "must not be retained",
    },
    candidates: [{ content: { parts: [{ text: "private conversation" }] } }],
  });
  expect(observed).toEqual({
    provider: "google", model: "text-model", source: "server_response", status: "reported",
    promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 8 }],
  });
  expect(JSON.stringify(observed)).not.toContain("private");
});

it("does not infer output tokens or accept malformed usage as a billable count", () => {
  expect(observeGeminiUsage("live-model", { usageMetadata: { promptTokenCount: 495, totalTokenCount: 520, thoughtsTokenCount: 24 } })).toEqual({
    provider: "google", model: "live-model", source: "server_response", status: "reported",
    promptTokenCount: 495, totalTokenCount: 520, thoughtsTokenCount: 24,
  });
  expect(observeGeminiUsage("text-model", {} ).status).toBe("missing");
  expect(observeGeminiUsage("text-model", { usageMetadata: { promptTokenCount: -1 } }).status).toBe("invalid");
  expect(observeGeminiUsage("text-model", { usageMetadata: { promptTokensDetails: [{ modality: "AUDIO", tokenCount: "12" }] } }).status).toBe("invalid");
  expect(observeGeminiUsage("text-model", { usageMetadata: {} }).status).toBe("invalid");
});
