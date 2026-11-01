/**
 * Real-provider synthetic evaluation of end-of-session note selection (DEC-064/065).
 * Fictional input only. Needs an explicit opt-in and the free local test project key.
 * Full model outputs go to .local/note-eval/ (git-ignored) so the educational quality can be read by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createGeminiExtractionGenerate } from "../src/server/voice-cascade";
import { extractNote, NOTE_EXTRACTION_LIMITS, type ExtractionGenerate } from "../src/voice/note-extraction";
import { EVAL_CASES, checkRun, type Violation } from "../src/voice/note-eval";

if (process.env.TALKIE_NOTE_EVAL !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
  console.error("Set TALKIE_NOTE_EVAL=gemini-free and GEMINI_FREE_TIER_CONFIRMED=true (free local test project only).");
  process.exit(2);
}
if (!process.env.GOOGLE_API_KEY?.trim()) { console.error("GOOGLE_API_KEY (free local test project) is required."); process.exit(2); }
// The shared Google call path also gates on the cascade test flag and a Soniox key. This evaluation uses neither
// the speech path nor Soniox, so satisfy the gate only after the explicit opt-in above.
process.env.TALKIE_VOICE_CASCADE_TEST = "enabled";
process.env.SONIOX_API_KEY ||= "unused-by-note-eval";
const repeats = Number(process.env.TALKIE_NOTE_EVAL_REPEATS ?? 3);
const rawGenerate = createGeminiExtractionGenerate();
// Free text-model limit seen on 2026-11-01 was 15 requests per minute, so start calls at least GAP ms apart.
const gapMs = Number(process.env.TALKIE_NOTE_EVAL_GAP_MS ?? 6000);
let nextStart = 0;
const errorKinds: Record<string, number> = {};
const generate: ExtractionGenerate = async (request, signal) => {
  const startAt = Math.max(Date.now(), nextStart);
  nextStart = startAt + gapMs;
  if (startAt > Date.now()) await new Promise(resolve => setTimeout(resolve, startAt - Date.now()));
  try { return await rawGenerate(request, signal); }
  catch (error) { // Record only the kind, never the error text or body.
    const kind = String((error as { upstreamStatus?: unknown }).upstreamStatus ?? (error as Error).name ?? "unknown");
    errorKinds[kind] = (errorKinds[kind] ?? 0) + 1; throw error;
  }
};
const outDir = `.local/note-eval/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(outDir, { recursive: true });
let calls = 0, runs = 0, failedRuns = 0;
const violations: { caseId: string; run: number; violation: Violation }[] = [];
for (const testCase of EVAL_CASES) {
  if (!testCase.expectCalls) { // The product skips the model when there is no user turn (see extractVoiceNote).
    console.log(`${testCase.id}: skipped (no user turn)`);
    continue;
  }
  for (let run = 1; run <= repeats; run++) {
    const result = await extractNote(testCase.snapshot, { generate, signal: AbortSignal.timeout(NOTE_EXTRACTION_LIMITS.totalTimeoutMs + 5000) });
    runs++; calls += result.calls;
    if (result.totalChunks - result.failedChunks === 0) failedRuns++;
    for (const violation of checkRun(testCase, result)) violations.push({ caseId: testCase.id, run, violation });
    writeFileSync(`${outDir}/${testCase.id}-${run}.json`, JSON.stringify({ title: testCase.title, expected: testCase.note, result }, null, 2));
    console.log(`${testCase.id} #${run}: calls=${result.calls} failedChunks=${result.failedChunks} dropped=${result.droppedItems} reasons=${JSON.stringify(result.dropReasons ?? {})} repaired=${result.repairedEvidence ?? 0} stripped=${result.strippedObservations ?? 0}`);
  }
}
const report = [`# 종료 노트 선별 평가 ${outDir}`, "", `호출 간격 최소 ${gapMs}ms · 실행 ${runs} · 호출 ${calls} · 구간 실패 ${failedRuns} · 오류 종류 ${JSON.stringify(errorKinds)}`, ""];
for (const testCase of EVAL_CASES) {
  report.push(`## ${testCase.id} · ${testCase.title}`, `기대: ${testCase.note}`, "", "입력:", ...testCase.snapshot.turns.map(x => `- ${x.turnId} ${x.role}: ${x.text}`),
    ...testCase.snapshot.corrections.map(c => `- 교정 ${c.correctionId}: ${c.sourceTurnId}→${c.deliveredTurnId} "${c.replacement}" 재시도 ${c.attempts.map(a => `${a.turnId}:${a.outcome}`).join(",") || "없음"}`), "");
}
writeFileSync(`${outDir}/REPORT.md`, report.join("\n"));
console.log(JSON.stringify({ runs, calls, failedRuns, errorKinds, gapMs, violationCount: violations.length, violations, outputs: outDir }, null, 2));
process.exit(violations.length || failedRuns ? 1 : 0);
