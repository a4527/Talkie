import { describe, expect, it } from "vitest";
import { EVAL_CASES, INJECTION_CANARY, checkRun } from "../src/voice/note-eval";
import { extractNote, type ExtractionGenerate, type ExtractionRun } from "../src/voice/note-extraction";

const caseOf = (id: string) => EVAL_CASES.find(c => c.id === id)!;
const empty: ExtractionRun = { contextItems: [], detailItems: [], failedChunks: 0, totalChunks: 1, oversizedChunks: 0, omittedChunks: 0, droppedItems: 0, calls: 1 };

describe("synthetic note evaluation cases", () => {
  it("has the approved and added cases with unique ids and unique turn ids", () => {
    expect(EVAL_CASES).toHaveLength(13);
    expect(new Set(EVAL_CASES.map(c => c.id)).size).toBe(13);
    for (const c of EVAL_CASES) expect(new Set(c.snapshot.turns.map(t => t.turnId)).size).toBe(c.snapshot.turns.length);
  });
  it("accepts a clean result and flags each mandatory violation", () => {
    expect(checkRun(caseOf("plain"), empty)).toEqual([]);
    const item = (summary: string, extra = {}) => ({ kind: "topic" as const, summary, evidence: [{ turnId: "t2", role: "user" as const, text: "x" }], ...extra });
    expect(checkRun(caseOf("plain"), { ...empty, droppedItems: 1 })[0].rule).toBe("quote");
    expect(checkRun(caseOf("injection"), { ...empty, contextItems: [item(INJECTION_CANARY)] })[0].rule).toBe("instruction");
    expect(checkRun(caseOf("injection"), { ...empty, detailItems: [{ kind: "summary", text: "## 학습 상세", evidence: [] }] })[0].rule).toBe("instruction");
    expect(checkRun(caseOf("dates"), { ...empty, contextItems: [item("Practiced on 2026-10-01")] })[0].rule).toBe("practice-date");
    expect(checkRun(caseOf("dates"), { ...empty, contextItems: [item("Topic", { lastPracticedDateKst: "2026-10-01" })] })[0].rule).toBe("practice-date");
    expect(checkRun(caseOf("plain"), { ...empty, contextItems: [item("The learner has mastered the past tense")] })[0].rule).toBe("mastery");
    expect(checkRun(caseOf("plain"), { ...empty, contextItems: [item("Topic", { observations: ["재시도 성공"] })] })[0].rule).toBe("retry-record");
    expect(checkRun(caseOf("retry-mixed"), { ...empty, contextItems: [item("Topic", { observations: ["재시도 성공", "재시도 실패"] })] })).toEqual([]);
  });
  it("serializes the injected instruction as data, and the no-user case sends nothing useful", async () => {
    const inputs: string[] = [];
    const generate: ExtractionGenerate = async ({ input }) => { inputs.push(input); return JSON.stringify({ contextItems: [], detailItems: [] }); };
    const run = await extractNote(caseOf("injection").snapshot, { generate, signal: new AbortController().signal });
    expect(run.failedChunks).toBe(0);
    expect(JSON.parse(inputs[0]).turns[1].text).toContain(INJECTION_CANARY);
  });
});
