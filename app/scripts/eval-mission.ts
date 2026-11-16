/**
 * Real-provider comparison of the end-of-mission evaluation with the fixed synthetic cases
 * (FIRST-MISSION-EVALUATION-CASES). Fictional text only. Needs an explicit opt-in and the free local test project key.
 * Full model judgements go to .local/mission-eval/ (git-ignored) for reading by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createGeminiExtractionGenerate, NOTE_EXTRACTION_MODEL } from "../src/server/voice-cascade";
import { NonRetryableExtractionError, type ExtractionGenerate } from "../src/voice/note-extraction";
import { evaluateMission, type EvaluationRun } from "../src/mission/evaluation";
import { currentMission } from "../src/mission/definitions";
import { HOLDOUT2_EVAL_CASES, HOLDOUT3_EVAL_CASES, HOLDOUT_EVAL_CASES, MISSION_EVAL_CASES, compareWithCase, type CaseComparison } from "../src/mission/eval-cases";

if (process.env.TALKIE_MISSION_EVAL !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
  console.error("Set TALKIE_MISSION_EVAL=gemini-free and GEMINI_FREE_TIER_CONFIRMED=true (free local test project only).");
  process.exit(2);
}
if (!process.env.GOOGLE_API_KEY?.trim()) { console.error("GOOGLE_API_KEY (free local test project) is required."); process.exit(2); }
// The shared Google call path also gates on the cascade flag and a Soniox key; this evaluation uses neither.
process.env.TALKIE_VOICE_CASCADE_TEST = "enabled";
process.env.SONIOX_API_KEY ||= "unused-by-mission-eval";

const repeats = Number(process.env.TALKIE_MISSION_EVAL_REPEATS ?? 3);
const only = process.env.TALKIE_MISSION_EVAL_ONLY?.split(",");
// TALKIE_MISSION_EVAL_SET=holdout runs the cases that were fixed before any run and never used for prompt tuning.
const caseSet = { holdout: HOLDOUT_EVAL_CASES, holdout2: HOLDOUT2_EVAL_CASES, holdout3: HOLDOUT3_EVAL_CASES }[process.env.TALKIE_MISSION_EVAL_SET ?? ""] ?? MISSION_EVAL_CASES;
const selected = caseSet.filter(c => !only || only.includes(c.id));
const gapMs = Number(process.env.TALKIE_MISSION_EVAL_GAP_MS ?? 6000);
const mission = currentMission("cafe-wrong-order");
if (!mission) throw new Error("mission definition missing");

// Comparison runs may name another model; the product path is unchanged. MAX_CALLS is a hard stop under the
// model's free daily request limit (RPD), so a run never relies on the provider rejecting the excess.
const model = process.env.TALKIE_MISSION_EVAL_MODEL?.trim() || NOTE_EXTRACTION_MODEL;
const maxCalls = Number(process.env.TALKIE_MISSION_EVAL_MAX_CALLS ?? 54);
if (!/^[a-z0-9.-]{1,64}$/.test(model) || !Number.isInteger(maxCalls) || maxCalls < 1) { console.error("invalid model or max calls"); process.exit(2); }
const tokens = { prompt: 0, output: 0, thoughts: 0, reported: 0 };
const rawGenerate = createGeminiExtractionGenerate(fetch, usage => {
  if (usage.status !== "reported") return;
  tokens.reported++; tokens.prompt += usage.promptTokenCount ?? 0; tokens.output += usage.candidatesTokenCount ?? 0; tokens.thoughts += usage.thoughtsTokenCount ?? 0;
}, model);
class CallBudgetExhausted extends Error {}
let nextStart = 0, calls = 0, invalidOutputs = 0;
const errorKinds: Record<string, number> = {};
let rawOutputs: unknown[] = [];
const generate: ExtractionGenerate = async (request, signal) => {
  if (calls >= maxCalls) throw new CallBudgetExhausted();
  const startAt = Math.max(Date.now(), nextStart);
  nextStart = startAt + gapMs;
  if (startAt > Date.now()) await new Promise(resolve => setTimeout(resolve, startAt - Date.now()));
  calls++;
  try { const text = await rawGenerate(request, signal); rawOutputs.push((() => { try { return JSON.parse(text); } catch { return text; } })()); return text; }
  catch (error) { // Kind only; never the error text or body.
    // The non-retryable wrapper drops the HTTP status; its message is the app error code (no provider text).
    const kind = error instanceof NonRetryableExtractionError ? `non-retryable:${error.message}` : String((error as { upstreamStatus?: unknown }).upstreamStatus ?? (error as Error).message ?? "unknown");
    errorKinds[kind] = (errorKinds[kind] ?? 0) + 1; throw error;
  }
};

const outDir = `.local/mission-eval/${new Date().toISOString().replace(/[:.]/g, "-")}-${model}`;
mkdirSync(outDir, { recursive: true });
type RunRecord = { caseId: string; run: number; result: EvaluationRun | null; comparison: CaseComparison | null; attempts: number };
const records: RunRecord[] = [];
const plan = selected.flatMap(testCase => Array.from({ length: Number(process.env[`TALKIE_MISSION_EVAL_REPEATS_${testCase.id.replace("-", "_")}`] ?? repeats) }, (_, i) => ({ testCase, run: i + 1 })));
for (const { testCase, run } of plan) {
  if (calls + 2 > maxCalls) { console.log(`call budget ${maxCalls} reached; stopping before ${testCase.id} #${run}`); break; }
  {
    rawOutputs = [];
    const before = calls;
    const result = await evaluateMission(testCase.snapshot, { ...mission, missionMode: testCase.missionMode, languageLevel: testCase.languageLevel,
      missionEndReason: testCase.missionEndReason, finalRouteId: testCase.finalRouteId }, { generate, signal: AbortSignal.timeout(200_000) });
    const attempts = calls - before;
    if (result) invalidOutputs += attempts - 1; else invalidOutputs += attempts;
    const comparison = result ? compareWithCase(testCase, result.judgements) : null;
    records.push({ caseId: testCase.id, run, result, comparison, attempts });
    // Every attempt's raw output is kept (synthetic data only) so a failed validation can be diagnosed.
    writeFileSync(`${outDir}/${testCase.id}-${run}.json`, JSON.stringify({ title: testCase.title, expected: testCase.expected, result, comparison, raw: rawOutputs }, null, 2));
    const score = result ? `${result.score.totalEarnedHalf / 2}/${result.score.totalMaxHalf / 2}` : "unsettled";
    console.log(`${testCase.id} #${run}: attempts=${attempts} score=${score} agreed=${comparison ? `${comparison.agreed}/${comparison.total}` : "-"} mismatches=${comparison?.mismatches.map(m => `${m.criterionId}:${m.expected}->${m.actual}${m.boundary ? "(경계)" : ""}`).join(",") ?? "-"}`);
  }
}

const verdictLabel: Record<string, string> = { met: "충족", partial: "부분", unmet: "미충족", undeterminable: "판정불가" };
const report = [`# 미션 평가 합성 사례 대조 ${outDir}`, "", `모델 ${model} · 실행 ${records.length} · 호출 ${calls}/${maxCalls} · 검증 실패 응답 ${invalidOutputs} · 오류 종류 ${JSON.stringify(errorKinds)} · 호출 간격 최소 ${gapMs}ms · 토큰(보고된 ${tokens.reported}회) 입력 ${tokens.prompt}·출력 ${tokens.output}·생각 ${tokens.thoughts}`, ""];
report.push("| 사례 | 기대 점수 | 실행별 점수 | 일치(기준 18개) |", "| --- | --- | --- | --- |");
for (const testCase of selected) {
  const runs = records.filter(r => r.caseId === testCase.id);
  if (!runs.length) continue;
  report.push(`| ${testCase.id} | ${testCase.expectedHalf ? `${testCase.expectedHalf.earned / 2}/${testCase.expectedHalf.max / 2}` : "보류"} | ${runs.map(r => r.result ? `${r.result.score.totalEarnedHalf / 2}/${r.result.score.totalMaxHalf / 2}` : "미확정").join(" · ")} | ${runs.map(r => r.comparison ? r.comparison.agreed : "-").join(" · ")} |`);
}
report.push("", "## 불일치 기준(실행 횟수)", "");
for (const testCase of selected) {
  const runs = records.filter(r => r.comparison);
  const counts = new Map<string, { n: number; boundary: boolean; reasons: string[] }>();
  if (!records.some(r => r.caseId === testCase.id)) continue;
  for (const r of runs.filter(x => x.caseId === testCase.id)) for (const m of r.comparison!.mismatches) {
    const key = `${m.criterionId} ${verdictLabel[m.expected]}→${verdictLabel[m.actual]}`;
    const entry = counts.get(key) ?? { n: 0, boundary: m.boundary, reasons: [] };
    entry.n++; entry.reasons.push(m.reason); counts.set(key, entry);
  }
  report.push(`### ${testCase.id} · ${testCase.title}`, ...(counts.size ? [...counts].map(([k, v]) => `- ${k} ×${v.n}${v.boundary ? " (문서상 경계)" : ""}: ${v.reasons[0]}`) : ["- 없음"]), "");
}
writeFileSync(`${outDir}/REPORT.md`, report.join("\n"));
console.log(JSON.stringify({ model, calls, maxCalls, tokens, invalidOutputs, errorKinds, unsettled: records.filter(r => !r.result).length, outputs: outDir }, null, 2));
