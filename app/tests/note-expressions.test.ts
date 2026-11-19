import { describe, expect, it } from "vitest";
import { buildNote, renderNoteMarkdown } from "../src/learning/note";
import { buildExpressionIndex, extractNoteExpressions, filterExpressions, noteDayMatches } from "../src/learning/note-expressions";
import { buildVoiceNoteMarkdown } from "../src/voice/note";

const snapshot = (expression: string) => ({ learningState: "conversation" as const,
  turns: [{ turnId: "u1", requestId: "r1", role: "user" as const, text: "I want coffee." },
    { turnId: "a1", requestId: "r1", role: "assistant" as const, text: expression }],
  corrections: [{ correctionId: "c1", sourceTurnId: "u1", deliveredTurnId: "a1", replacement: expression, explanation: "polite request", attempts: [] }],
});
const user = { turnId: "u1", role: "user" as const, text: "I want coffee." };
const voiceNote = (expression: string, date: string, extraction?: Parameters<typeof buildVoiceNoteMarkdown>[3]) =>
  ({ learningEndDateKst: date, noteMarkdown: buildVoiceNoteMarkdown(snapshot(expression), `${date}T00:00:00Z`, [], extraction)! });

describe("note expressions (F-12, B-08)", () => {
  it("reads review items and expression details, but never generated examples, summaries or praise", () => {
    const note = voiceNote("Could I have a coffee, please?", "2026-11-02", { incomplete: false, details: [
      { kind: "summary", text: "Ordered at a cafe.", evidence: [user] },
      { kind: "key_expression", text: "for here or to go", evidence: [user] },
      { kind: "question_expression", text: "How do I say 'to go'?", evidence: [user] },
      { kind: "example", text: "Could I have a tea, please?", evidence: [user], adapted: true },
      { kind: "praise", text: "Clear order.", evidence: [user] },
    ] });
    expect(extractNoteExpressions(note.noteMarkdown)).toEqual([
      { text: "Could I have a coffee, please?", kind: "review" },
      { text: "for here or to go", kind: "key_expression" },
      { text: "How do I say 'to go'?", kind: "question_expression" },
    ]);
  });

  it("keeps literal text and reads older demo/voice notes from their review heading only", () => {
    const literal = "I'd like <tea> & `milk`";
    expect(extractNoteExpressions(voiceNote(literal, "2026-11-02").noteMarkdown)).toEqual([{ text: literal, kind: "review" }]);
    const demo = renderNoteMarkdown(buildNote({ requestId: "r", endedAt: "2026-10-23T03:00:00Z",
      turns: snapshot("I went to a cafe yesterday.").turns, corrections: snapshot("I went to a cafe yesterday.").corrections }));
    expect(extractNoteExpressions(demo)).toEqual([{ text: "I went to a cafe yesterday.", kind: "review" }]);
    expect(extractNoteExpressions("# x\n\n## 다음 복습\n\n> Older voice note.\n\n## 대화 근거 일부\n\n> not an expression\n"))
      .toEqual([{ text: "Older voice note.", kind: "review" }]);
    expect(extractNoteExpressions("# x\n\n## 대화 근거 일부\n\n> just a quote\n")).toEqual([]);
  });

  it("merges the same expression across days, newest first, and searches case/punctuation-insensitively", () => {
    const index = buildExpressionIndex([voiceNote("Could I get a refund?", "2026-11-01"), voiceNote("could I get a refund", "2026-11-03"),
      voiceNote("Can I pay by card?", "2026-11-02")]);
    expect(index.map(e => [e.text, e.dates])).toEqual([
      ["could I get a refund", ["2026-11-03", "2026-11-01"]], ["Can I pay by card?", ["2026-11-02"]]]);
    expect(filterExpressions(index, "  REFUND ").map(e => e.text)).toEqual(["could I get a refund"]);
    expect(filterExpressions(index, "")).toHaveLength(2);
    expect(filterExpressions(index, "latte")).toEqual([]);
  });

  it("finds a day by date or visible note text, not by stored turn IDs", () => {
    const day = [voiceNote("Can I pay by card?", "2026-11-02")];
    expect(noteDayMatches("2026-11-02", day, "11-02")).toBe(true);
    expect(noteDayMatches("2026-11-02", day, "pay by card")).toBe(true);
    expect(noteDayMatches("2026-11-02", day, "u1 / user")).toBe(false);
    expect(noteDayMatches("2026-11-02", day, "")).toBe(true);
  });
});
