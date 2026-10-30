import { expect, it } from "vitest";
import { SonioxEvents } from "../src/voice/cascade/soniox-events";
import type { RecognitionEvent } from "../src/voice/cascade/providers";
it("discards revised partials and emits only finalized tokens at the endpoint", () => {
  const events: RecognitionEvent[] = []; const decoder = new SonioxEvents(e => events.push(e), () => "one");
  decoder.receive({ tokens: [{ text: "I goes", is_final: false }] });
  decoder.receive({ tokens: [{ text: "I go", is_final: false }] });
  decoder.receive({ tokens: [{ text: "I go", is_final: true }, { text: " home.", is_final: true }, { text: "<end>", is_final: true }] });
  expect(events).toEqual([{ type: "speech-start", utteranceId: "one" }, { type: "final", utteranceId: "one", text: "I go home." }]);
});
it("rejects invalid tokens without accepting unconfirmed endpoints", () => {
  const decoder = new SonioxEvents(() => {});
  expect(() => decoder.receive({ tokens: [{ text: "<end>", is_final: false }] })).toThrow();
});

it("classifies provider 402 without exposing provider payload", () => {
  const events: RecognitionEvent[] = []; new SonioxEvents(e => events.push(e)).receive({ tokens: [], error_code: 402, error_message: "sensitive upstream details" });
  expect(events).toEqual([{ type: "error", code: "billing" }]);
});
