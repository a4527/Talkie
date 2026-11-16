/**
 * Real-provider comparison of the end-of-mission evaluation with the 80%-boundary cases (BOUNDARY_EVAL_CASES,
 * candidates fixed before any run). Fictional text only. Same opt-in and model as eval-mission.ts, but the free
 * project is shared with other runs, so calls are spaced at least 20s apart and capped at 30 in total.
 * Run: node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/eval-mission-boundary.ts
 * Outputs go to .local/mission-eval-boundary/<timestamp>/ (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createGeminiExtractionGenerate, NOTE_EXTRACTION_MODEL } from "../src/server/voice-cascade";
import { NonRetryableExtractionError, type ExtractionGenerate } from "../src/voice/note-extraction";
import { evaluateMission, type EvaluationRun } from "../src/mission/evaluation";
import { currentMission } from "../src/mission/definitions";
import { BOUNDARY_EVAL_CASES, compareWithCase, type CaseComparison } from "../src/mission/eval-cases";

if (process.env.TALKIE_MISSION_EVAL !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
  console.error("Set TALKIE_MISSION_EVAL=gemini-free and GEMINI_FREE_TIER_CONFIRMED=true (free local test project only).");
  process.exit(2);
}
if (!process.env.GOOGLE_API_KEY?.trim()) { console.error("GOOGLE_API_KEY (free local test project) is required."); process.exit(2); }
process.env.TALKIE_VOICE_CASCADE_TEST = "enabled";
process.env.SONIOX_API_KEY ||= "unused-by-mission-eval";

const HARD_MAX_CALLS = 30, MIN_GAP_MS = 20_000;
const repeats = Number(process.env.TALKIE_MISSION_EVAL_REPEATS ?? 3);
const only = process.env.TALKIE_MISSION_EVAL_ONLY?.split(",");
const selected = BOUNDARY_EVAL_CASES.filter(c => !only || only.includes(c.id));
const gapMs = Math.max(MIN_GAP_MS, Number(process.env.TALKIE_MISSION_EVAL_GAP_MS ?? MIN_GAP_MS));
const maxCalls = Math.min(HARD_MAX_CALLS, Number(process.env.TALKIE_MISSION_EVAL_MAX_CALLS ?? HARD_MAX_CALLS));
const model = process.env.TALKIE_MISSION_EVAL_MODEL?.trim() || NOTE_EXTRACTION_MODEL;
if (!/^[a-z0-9.-]{1,64}$/.test(model) || !Number.isInteger(maxCalls) || maxCalls < 1 || !Number.isInteger(repeats) || repeats < 1) { console.error("invalid settings"); process.exit(2); }
const mission = currentMission("cafe-wrong-order");
if (!mission) throw new Error("mission definition missing");

const tokens = { prompt: 0, output: 0, thoughts: 0, reported: 0 };
const rawGenerate = createGeminiExtractionGenerate(fetch, usage => {
  if (usage.status !== "reported") return;
  tokens.reported++; tokens.prompt += usage.promptTokenCount ?? 0; tokens.output += usage.candidatesTokenCount ?? 0; tokens.thoughts += usage.thoughtsTokenCount ?? 0;
}, model);
class CallBudgetExhausted extends Error {}
let lastStart = 0, calls = 0, invalidOutputs = 0;
const errorKinds: Record<string, number> = {};
const callLog: { call: number; startedAt: string; outcome: string }[] = [];
let rawOutputs: unknown[] = [];
const generate: ExtractionGenerate = async (request, signal) => {
  if (calls >= maxCalls) throw new CallBudgetExhausted();
  // Gap measured from the previous call's start (as in eval-mission.ts), never shorter than 20s.
  const waitMs = lastStart + gapMs - Date.now();
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastStart = Date.now();
  calls++;
  const entry = { call: calls, startedAt: new Date(lastStart).toISOString(), outcome: "ok" };
  callLog.push(entry);
  try { const text = await rawGenerate(request, signal); rawOutputs.push((() => { try { return JSON.parse(text); } catch { return text; } })()); return text; }
  catch (error) { // Kind only; never the error text or body.
    const kind = error instanceof NonRetryableExtractionError ? `non-retryable:${error.message}` : String((error as { upstreamStatus?: unknown }).upstreamStatus ?? (error as Error).message ?? "unknown");
    errorKinds[kind] = (errorKinds[kind] ?? 0) + 1; entry.outcome = kind; throw error;
  }
};

const outDir = `.local/mission-eval-boundary/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(outDir, { recursive: true });
type RunRecord = { caseId: string; run: number; result: EvaluationRun | null; comparison: CaseComparison | null; attempts: number };
const records: RunRecord[] = [];
const runOnce = async (testCase: (typeof selected)[number], run: number, file: string) => {
  rawOutputs = [];
  const before = calls;
  const result = await evaluateMission(testCase.snapshot, { ...mission, missionMode: testCase.missionMode, languageLevel: testCase.languageLevel,
    missionEndReason: testCase.missionEndReason, finalRouteId: testCase.finalRouteId }, { generate, signal: AbortSignal.timeout(300_000) });
  const attempts = calls - before;
  invalidOutputs += result ? attempts - 1 : attempts;
  const comparison = result ? compareWithCase(testCase, result.judgements) : null;
  writeFileSync(`${outDir}/${file}.json`, JSON.stringify({ title: testCase.title, expected: testCase.expected, expectedHalf: testCase.expectedHalf, result, comparison, raw: rawOutputs }, null, 2));
  const score = result ? `${result.score.totalEarnedHalf / 2}/${result.score.totalMaxHalf / 2}` : "unsettled";
  console.log(`${file}: attempts=${attempts} calls=${calls}/${maxCalls} score=${score} agreed=${comparison ? `${comparison.agreed}/${comparison.total}` : "-"} mismatches=${comparison?.mismatches.map(m => `${m.criterionId}:${m.expected}->${m.actual}${m.boundary ? "(경계)" : ""}`).join(",") ?? "-"}`);
  return { caseId: testCase.id, run, result, comparison, attempts };
};

const plan = selected.flatMap(testCase => Array.from({ length: repeats }, (_, i) => ({ testCase, run: i + 1 })));
for (const { testCase, run } of plan) {
  if (calls + 1 > maxCalls) { console.log(`call budget ${maxCalls} reached; stopping before ${testCase.id} #${run}`); break; }
  records.push(await runOnce(testCase, run, `${testCase.id}-${run}`));
}
// Re-run unsettled runs (e.g. 429/503 twice) only while the budget allows; the first record is kept on file.
for (const record of records.filter(r => !r.result)) {
  if (calls + 1 > maxCalls) break;
  const testCase = selected.find(c => c.id === record.caseId)!;
  const retry = await runOnce(testCase, record.run, `${record.caseId}-${record.run}-retry`);
  if (retry.result) Object.assign(record, retry, { attempts: record.attempts + retry.attempts });
}

const pct = (h: { earned: number; max: number }) => h.max ? Math.round((h.earned / h.max) * 1000) / 10 : null;
const verdictLabel: Record<string, string> = { met: "충족", partial: "부분", unmet: "미충족", undeterminable: "판정불가" };
const report = [`# 미션 평가 80% 경계 사례 대조 ${outDir}`, "", `모델 ${model} · 실행 ${records.length} · 호출 ${calls}/${maxCalls} · 검증 실패·오류 응답 ${invalidOutputs} · 오류 종류 ${JSON.stringify(errorKinds)} · 호출 간격 최소 ${gapMs}ms · 토큰(보고된 ${tokens.reported}회) 입력 ${tokens.prompt}·출력 ${tokens.output}·생각 ${tokens.thoughts}`, ""];
report.push("| 사례 | 후보 점수(달성) | 실행별 점수(달성) | 달성 일치 | 일치(기준 18개) |", "| --- | --- | --- | --- | --- |");
const meets = (h: { earned: number; max: number }) => h.max > 0 && h.earned * 10 >= h.max * 8;
for (const testCase of selected) {
  const runs = records.filter(r => r.caseId === testCase.id);
  if (!runs.length || !testCase.expectedHalf) continue;
  const expectedMeets = meets(testCase.expectedHalf);
  const cell = (r: RunRecord) => r.result ? `${r.result.score.totalEarnedHalf / 2}/${r.result.score.totalMaxHalf / 2}(${r.result.score.meetsThreshold ? "달성" : "미달"})` : "미확정";
  const agree = runs.filter(r => r.result).filter(r => r.result!.score.meetsThreshold === expectedMeets).length;
  report.push(`| ${testCase.id} | ${testCase.expectedHalf.earned / 2}/${testCase.expectedHalf.max / 2}=${pct(testCase.expectedHalf)}%(${expectedMeets ? "달성" : "미달"}) | ${runs.map(cell).join(" · ")} | ${agree}/${runs.filter(r => r.result).length} | ${runs.map(r => r.comparison ? r.comparison.agreed : "-").join(" · ")} |`);
}
report.push("", "## 불일치 기준(실행 횟수)", "");
for (const testCase of selected) {
  const counts = new Map<string, { n: number; boundary: boolean; reasons: string[] }>();
  if (!records.some(r => r.caseId === testCase.id)) continue;
  for (const r of records.filter(x => x.caseId === testCase.id && x.comparison)) for (const m of r.comparison!.mismatches) {
    const key = `${m.criterionId} ${verdictLabel[m.expected]}→${verdictLabel[m.actual]}`;
    const entry = counts.get(key) ?? { n: 0, boundary: m.boundary, reasons: [] };
    entry.n++; entry.reasons.push(m.reason); counts.set(key, entry);
  }
  report.push(`### ${testCase.id} · ${testCase.title}`, ...(counts.size ? [...counts].map(([k, v]) => `- ${k} ×${v.n}${v.boundary ? " (경계)" : ""}: ${v.reasons.join(" / ")}`) : ["- 없음"]), "");
}
writeFileSync(`${outDir}/REPORT.md`, report.join("\n"));
writeFileSync(`${outDir}/calls.json`, JSON.stringify({ model, gapMs, maxCalls, calls, errorKinds, callLog, tokens }, null, 2));
console.log(JSON.stringify({ model, calls, maxCalls, tokens, invalidOutputs, errorKinds, unsettled: records.filter(r => !r.result).length, outputs: outDir }, null, 2));
