import { describe, expect, it } from "vitest";
import { buildExpressionIndex, extractNoteExpressions } from "../src/learning/note-expressions";
import { MISSION_NOTE_LIMITS, buildVoiceNoteMarkdown } from "../src/voice/note";
import { readNoteContext, type NoteContextItem } from "../src/voice/note-context";
import type { NoteDetailItem } from "../src/voice/note-extraction";
import { selectPriorLearningContext } from "../src/voice/prior-learning";

// Synthetic five-correction practice: u1..u5 each corrected by a1..a5, the first one retried successfully.
const fixes = ["Could I get a hot one?", "It should be decaf.", "Could you remake it?", "I'd like a refund.", "That works for me."];
const turns = fixes.flatMap((fix, i) => [
  { turnId: `u${i + 1}`, requestId: `r${i + 1}`, role: "user" as const, text: `wrong sentence ${i + 1}` },
  { turnId: `a${i + 1}`, requestId: `r${i + 1}`, role: "assistant" as const, text: `Quick tip: "${fix}". Can you say it again?` },
]);
const snapshot = { learningState: "conversation" as const, turns: [...turns, { turnId: "u6", requestId: "r6", role: "user" as const, text: fixes[0] }],
  corrections: fixes.map((fix, i) => ({ correctionId: `c${i + 1}`, sourceTurnId: `u${i + 1}`, deliveredTurnId: `a${i + 1}`, replacement: fix, explanation: `reason ${i + 1}`,
    attempts: i === 0 ? [{ turnId: "u6", outcome: "success" as const }] : [] })) };
const user = (n: number) => ({ turnId: `u${n}`, role: "user" as const, text: `wrong sentence ${n}` });
const aiReview = (n: number): NoteContextItem => ({ kind: "review", summary: `AI pick ${n}`, evidence: [user(1)] });
const detail = (kind: NoteDetailItem["kind"], n: number, adapted = false): NoteDetailItem => ({ kind, text: `${kind.replace("_", " ")} ${n}`, evidence: [user(2)], ...(adapted ? { adapted: true } : {}) });
const extraction = { incomplete: false, details: [
  ...[1, 2].map(n => detail("summary", n)), detail("praise", 1), detail("example", 1, true),
  ...[1, 2, 3, 4].map(n => detail("key_expression", n)), ...[1, 2, 3, 4].map(n => detail("correction", n)), detail("next_review", 1), detail("question_expression", 1),
] };
const ended = "2026-11-19T03:00:00Z";

describe("concise mission note (DEC-098)", () => {
  const mission = buildVoiceNoteMarkdown(snapshot, ended, [1, 2, 3, 4].map(aiReview), extraction, { mission: true })!;
  it("keeps every delivered correction with its reason and retry, and caps AI review picks", () => {
    const reviews = readNoteContext(mission).filter(i => i.kind === "review").map(i => i.summary);
    expect(reviews).toEqual(["AI pick 1", "AI pick 2", "AI pick 3", ...fixes]);
    for (let i = 1; i <= 5; i++) expect(mission).toContain(`reason ${i}`);
    expect(mission).toContain("재시도 u6: AI 판정 성공");
    expect(MISSION_NOTE_LIMITS.aiReview).toBe(3);
  });
  it("leaves out praise and generated examples, keeps one summary and at most three items per kind", () => {
    expect(mission).not.toContain("praise 1");
    expect(mission).not.toContain("example 1");
    expect(mission).not.toContain("복습용 응용");
    expect(mission).toContain("summary 1");
    expect(mission).not.toContain("summary 2");
    expect(mission).toContain("key expression 3");
    expect(mission).not.toContain("key expression 4");
    expect(mission).toContain("correction 3");
    expect(mission).not.toContain("correction 4");
    expect(mission).toContain("next review 1");
    expect(mission).toContain("question expression 1");
    // A cap is a choice, not a lost record: the note does not claim missing content.
    expect(mission).not.toContain("누락");
  });
  it("leaves free-conversation notes as they were", () => {
    const free = buildVoiceNoteMarkdown(snapshot, ended, [1, 2, 3, 4].map(aiReview), extraction)!;
    expect(readNoteContext(free).filter(i => i.kind === "review").map(i => i.summary)).toEqual(["AI pick 1", "AI pick 2", "AI pick 3", "AI pick 4", ...fixes.slice(-3)]);
    expect(free).toContain("praise 1");
    expect(free).toContain("복습용 응용");
  });
});

describe("review choices (DEC-098)", () => {
  const markdown = buildVoiceNoteMarkdown(snapshot, ended, [], undefined, { mission: true })!;
  const numbers = readNoteContext(markdown).map(i => [i.summary, i.noteItemNumber]);
  it("reads back each review item's number from its heading", () => {
    expect(numbers).toEqual(fixes.map((fix, i) => [fix, i + 1]));
  });
  it("keeps a turned-off item in the note but out of later review and the expression list", () => {
    const note = { learningEndDateKst: "2026-11-19", noteMarkdown: markdown };
    // Without a choice the oldest-first selection picks the first two.
    expect(selectPriorLearningContext([note]).reviewExpressions).toHaveLength(2);
    const chosen = selectPriorLearningContext([{ ...note, excludedReviewItems: [1, 2, 4, 5] }]).reviewExpressions.map(e => e.expression);
    expect(chosen).toEqual([fixes[2]]);
    expect(extractNoteExpressions(markdown, [1]).map(e => e.text)).not.toContain(fixes[0]);
    expect(extractNoteExpressions(markdown, [1])).toHaveLength(4);
    expect(buildExpressionIndex([{ ...note, excludedReviewItems: [1, 2, 3, 4, 5] }])).toEqual([]);
    expect(markdown).toContain(fixes[0]);
  });
});
