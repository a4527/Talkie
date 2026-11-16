/**
 * Real-provider multi-turn check of the "cafe-wrong-order" mission in real mode (split text path, no speech).
 * Fixed learner scripts are fed through the app's own CascadeAdapter (fake STT/TTS, real cascadeText on the
 * text step), VoiceLearningRecords + MissionTracker (validator, auto end, no-progress preview and closing line),
 * and every finished dialogue goes once through the end-of-mission evaluation (evaluateMission).
 * Fictional text only; needs the explicit free-project opt-in. Outputs go to .local/mission-dialogue-real/ (git-ignored).
 * Scripts and expectations below were fixed before the first run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cascadeText, createGeminiExtractionGenerate, NOTE_EXTRACTION_MODEL, type CascadeMission } from "../src/server/voice-cascade";
import { CascadeAdapter } from "../src/voice/adapters/cascade";
import { VoiceLearningRecords } from "../src/voice/learning";
import type { VoiceEvent } from "../src/voice/port";
import type { CascadeProviders, RecognitionEvent } from "../src/voice/cascade/providers";
import { DEFAULT_NO_PROGRESS_THRESHOLD, findCompletedRoute, type MissionStateReport } from "../src/mission/realtime";
import { evaluateMission, type EvaluationRun } from "../src/mission/evaluation";
import { currentMission, type LanguageLevel } from "../src/mission/definitions";
import type { GeminiUsageObservation } from "../src/server/voice-usage";

if (process.env.TALKIE_MISSION_EVAL !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
  console.error("Set TALKIE_MISSION_EVAL=gemini-free and GEMINI_FREE_TIER_CONFIRMED=true (free local test project only).");
  process.exit(2);
}
if (!process.env.GOOGLE_API_KEY?.trim()) { console.error("GOOGLE_API_KEY (free local test project) is required."); process.exit(2); }
// The shared Google call path also gates on the cascade flag and a Soniox key; this check uses neither STT nor TTS.
process.env.TALKIE_VOICE_CASCADE_TEST = "enabled";
process.env.SONIOX_API_KEY ||= "unused-by-dialogue-eval";

const mission = currentMission("cafe-wrong-order");
if (!mission) throw new Error("mission definition missing");
const MAX_CALLS = Number(process.env.TALKIE_DIALOGUE_EVAL_MAX_CALLS ?? 80);
const GAP_MS = Math.max(20_000, Number(process.env.TALKIE_DIALOGUE_EVAL_GAP_MS ?? 20_000));
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------------------------------------
// Fixed scripts and expectations (decided before running). `lines` are the learner's utterances in order;
// lines after `expected.endAfterLine` are spares used only when the conversation has not ended yet.
type Expected = { endReason: "goal_completed" | "no_progress_failed"; finalRouteId: string | null; endAfterLine: number; events: string[]; progress: ("progress" | "no_progress")[] };
type Script = { id: string; title: string; level: LanguageLevel; lines: string[]; expected: Expected };
const SCRIPTS: Script[] = [
  { id: "a-remake", title: "문제 설명→처리 요청→조건 동의로 재제조 완료", level: "B1",
    lines: [
      "Excuse me, I think there's a problem with my drink. I ordered a hot decaf latte, but this one is iced and it has regular caffeine.",
      "Could you make me a new one, please? Hot and decaf.",
      "Yes, that's fine. I can wait five minutes.",
      "Okay, thank you.",
    ],
    expected: { endReason: "goal_completed", finalRouteId: "remake", endAfterLine: 3,
      events: ["proposed:remake", "user_accepted:remake", "staff_confirmed:remake"], progress: ["progress", "progress", "progress"] } },
  { id: "b-refund", title: "처음부터 환불 요청→조건 동의로 환불 완료", level: "C",
    lines: [
      "Hi, sorry, this isn't what I ordered. I asked for a hot decaf latte and this is an iced regular one. I'd rather just get a refund, if that's possible.",
      "Yes, that works for me, thanks.",
      "Great, thank you.",
    ],
    expected: { endReason: "goal_completed", finalRouteId: "refund", endAfterLine: 2,
      events: ["proposed:refund", "user_accepted:refund", "staff_confirmed:refund"], progress: ["progress", "progress"] } },
  { id: "c-change", title: "재제조 조건을 듣고 수락하려다 환불로 경로 변경", level: "B2",
    lines: [
      "Hi, I ordered a hot decaf latte, but I got an iced latte with regular caffeine instead.",
      "Could you remake it as a hot decaf, please?",
      "Okay, five minutes is fine. Actually, no, sorry, I'm running late for a meeting. Could I just get a refund instead?",
      "Yes, a full refund is fine. Thank you.",
      "Thanks.",
    ],
    expected: { endReason: "goal_completed", finalRouteId: "refund", endAfterLine: 4,
      events: ["proposed:remake", "route_changed:refund", "proposed:refund", "user_accepted:refund", "staff_confirmed:refund"],
      progress: ["progress", "progress", "progress", "progress"] } },
  { id: "d-fail", title: "엉뚱한 답을 반복해 실전 실패", level: "A2",
    lines: [
      "Hello. My drink is wrong. I order hot decaf latte. This is cold and have caffeine.",
      "The weather is very nice today.",
      "I like the music here.",
      "My friend is coming soon.",
      "Do you have cookies?",
      "I am happy today.",
    ],
    expected: { endReason: "no_progress_failed", finalRouteId: null, endAfterLine: 4, events: [],
      progress: ["progress", "no_progress", "no_progress", "no_progress"] } },
  { id: "e-a1", title: "A1 짧고 서툰 발화로 재제조 완료", level: "A1",
    lines: [
      "Hi. This drink, wrong.",
      "I want hot. This cold.",
      "And no caffeine. Decaf.",
      "New one, please.",
      "Yes. Okay.",
      "Thank you.",
    ],
    expected: { endReason: "goal_completed", finalRouteId: "remake", endAfterLine: 5,
      events: ["proposed:remake", "user_accepted:remake", "staff_confirmed:remake"], progress: ["progress", "progress", "progress", "progress", "progress"] } },
];
const only = process.env.TALKIE_DIALOGUE_EVAL_ONLY?.split(",");
const selected = SCRIPTS.filter(s => !only || only.includes(s.id));

// ---------------------------------------------------------------------------------------------------------
// One shared, bounded, spaced call gate for every provider call (dialogue replies, closing lines, evaluation).
class CallBudgetExhausted extends Error {}
let calls = 0, nextStart = 0, extraGap = 0;
const errorKinds: Record<string, number> = {};
const callLog: { n: number; purpose: string; at: string; ms: number; status: string }[] = [];
const tokens = { prompt: 0, output: 0, thoughts: 0, reported: 0 };
const onUsage = (usage: GeminiUsageObservation) => {
  if (usage.status !== "reported") return;
  tokens.reported++; tokens.prompt += usage.promptTokenCount ?? 0; tokens.output += usage.candidatesTokenCount ?? 0; tokens.thoughts += usage.thoughtsTokenCount ?? 0;
};
const statusOf = (error: unknown) => String((error as { upstreamStatus?: unknown }).upstreamStatus ?? (error as { code?: unknown }).code ?? (error as Error)?.message ?? "unknown");
async function gated<T>(purpose: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (calls >= MAX_CALLS) throw new CallBudgetExhausted();
    const startAt = Math.max(Date.now(), nextStart);
    if (startAt > Date.now()) await new Promise(resolve => setTimeout(resolve, startAt - Date.now()));
    nextStart = Date.now() + GAP_MS + extraGap; calls++;
    const began = Date.now();
    try {
      const value = await fn();
      callLog.push({ n: calls, purpose, at: new Date(began).toISOString(), ms: Date.now() - began, status: "ok" });
      return value;
    } catch (error) { // Kind only; never the error text or body.
      const kind = statusOf(error);
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
      callLog.push({ n: calls, purpose, at: new Date(began).toISOString(), ms: Date.now() - began, status: kind });
      console.log(`  call ${calls} ${purpose}: error ${kind}`);
      if ((kind === "429" || kind === "503") && attempt < MAX_RETRIES) { extraGap = Math.min(Math.max(extraGap * 2, 20_000), 120_000); nextStart = Date.now() + GAP_MS + extraGap; continue; }
      throw error;
    }
  }
}

// Raw model output of the last text call, captured from the response body (synthetic data only).
let lastRaw: string | undefined;
const capturingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.ok) {
    try { const body = await response.clone().json(); lastRaw = body?.candidates?.[0]?.content?.parts?.[0]?.text; } catch { lastRaw = undefined; }
  }
  return response;
};

// ---------------------------------------------------------------------------------------------------------
type Step = {
  line: number; learner: string; inputTurnId?: string; replyTurnId?: string;
  rawReply?: string; rawClosing?: string; spoken?: string; closingUsed: boolean;
  reported?: MissionStateReport; preview?: string; committedEventsAdded: string[]; droppedEvents: string[];
  noProgressCount: number; outcomeAfter?: string; error?: string;
};
type DialogueResult = {
  id: string; title: string; level: LanguageLevel; expected: Expected; steps: Step[];
  actual: { endReason: string; finalRouteId: string | null; endAfterLine: number | null; events: string[]; progress: (string | undefined)[]; closingLine?: string };
  mismatches: string[]; snapshot: unknown; evaluation: EvaluationRun | null; evaluationRaw: unknown[]; aborted?: string;
};

const evalGenerateRaw = createGeminiExtractionGenerate(fetch, onUsage);
let evalRaw: unknown[] = [];

async function runDialogue(script: Script): Promise<DialogueResult> {
  const cascadeMission: CascadeMission = { definition: mission!.definition, missionMode: "real", languageLevel: script.level };
  const routeIds = mission!.definition.routes.map(r => r.routeId);
  // Same composition as use-voice-learning: app-side records with the mission validator receive every port event.
  const records = new VoiceLearningRecords(undefined, { missionMode: "real", routeIds });
  const steps: Step[] = [];
  let current: Step | undefined;
  let sttEmit: ((event: RecognitionEvent) => void) | undefined;
  let waiter: { resolve: (e: VoiceEvent) => void } | undefined;
  const providers: CascadeProviders = {
    stt: { async connect(emit) { sttEmit = emit; }, sendAudio() {}, close() {} },
    llm: { async respond(request, signal) {
      const purpose = `${script.id}#${current?.line}${request.closing ? ":closing" : ""}`;
      const reply = await gated(purpose, () => { lastRaw = undefined;
        return cascadeText(request.context, undefined, true, AbortSignal.any([signal, AbortSignal.timeout(90_000)]), capturingFetch, onUsage, cascadeMission, request.closing); });
      if (current) { if (request.closing) { current.rawClosing = lastRaw; current.closingUsed = true; } else { current.rawReply = lastRaw; current.reported = reply.missionReport; } }
      return reply;
    } },
    tts: { async *synthesize() { yield { pcm: new Uint8Array(4800), sampleRateHz: 24000 }; } },
  };
  const advisor = (inputTurnId: string, report: MissionStateReport) => {
    const r = records.previewMissionEnding(inputTurnId, report);
    if (current) current.preview = r ?? "none";
    return r;
  };
  const adapter = new CascadeAdapter(providers, event => {
    records.apply(event);
    if (event.type === "transcript" && event.role === "assistant" && current) { current.spoken = event.text; current.replyTurnId = event.turnId; }
    if (event.type === "transcript" && event.role === "user" && current) current.inputTurnId = event.turnId;
    if (event.type === "response-complete" || event.type === "error" || event.type === "closed") waiter?.resolve(event);
  }, { learning: true, missionMode: "real", missionAdvisor: advisor, responseTimeoutMs: 15 * 60_000 });
  await adapter.connect(records.getSnapshot());

  let aborted: string | undefined;
  let eventsBefore: string[] = [];
  const committed = () => (records.getSnapshot().missionProgress?.routeEvents ?? []).map(e => `${e.kind}:${e.routeId}`);
  for (let i = 0; i < script.lines.length && !records.getMissionOutcome(); i++) {
    current = { line: i + 1, learner: script.lines[i], closingUsed: false, committedEventsAdded: [], droppedEvents: [], noProgressCount: 0 };
    steps.push(current);
    const done = new Promise<VoiceEvent>(resolve => { waiter = { resolve }; });
    sttEmit!({ type: "speech-start", utteranceId: `${script.id}-${i}` });
    sttEmit!({ type: "final", utteranceId: `${script.id}-${i}`, text: script.lines[i] });
    const end = await done;
    if (end.type !== "response-complete") { aborted = `adapter ${end.type}${end.type === "error" ? `:${end.code}` : ""}`; current.error = aborted; break; }
    // Output device acknowledgement, then the same "played" event the playback layer applies.
    adapter.acknowledgePlayback(end.turnId);
    records.apply({ type: "played", turnId: end.turnId });
    const after = committed();
    current.committedEventsAdded = after.slice(eventsBefore.length);
    const reportedEvents = (current.reported?.routeEvents ?? []).map(e => `${e.kind}:${e.routeId}`);
    current.droppedEvents = reportedEvents.filter(e => !current!.committedEventsAdded.includes(e));
    eventsBefore = after;
    current.noProgressCount = records.getSnapshot().missionProgress?.noProgress.count ?? 0;
    const outcome = records.getMissionOutcome();
    current.outcomeAfter = outcome ? (outcome.reason === "goal_completed" ? `goal_completed:${outcome.routeId}` : outcome.reason) : undefined;
    console.log(`${script.id} L${i + 1} [${current.reported?.progress ?? "-"}] ${reportedEvents.join(",") || "∅"}${current.closingUsed ? " (closing)" : ""} → ${current.spoken?.replace(/\s+/g, " ").slice(0, 150)}${current.outcomeAfter ? ` ⇒ ${current.outcomeAfter}` : ""}`);
  }
  adapter.close();

  // End reason as the server derives it after saves stop (server/learning.ts recordMissionEnd): verified
  // completion, then a verified real-mode streak, otherwise the learner ended (script exhausted or aborted).
  const snapshot = records.getSnapshot();
  const order = new Map(snapshot.turns.map((t, i) => [t.turnId, i]));
  const finalRouteId = findCompletedRoute(snapshot.missionProgress?.routeEvents ?? [], id => order.get(id)) ?? null;
  const np = snapshot.missionProgress?.noProgress;
  const endReason = finalRouteId ? "goal_completed" : np && np.count >= DEFAULT_NO_PROGRESS_THRESHOLD && np.evidenceTurnIds.every(id => order.has(id)) ? "no_progress_failed" : "user_ended";
  const outcomeStep = steps.findIndex(s => s.outcomeAfter);
  const actual = { endReason, finalRouteId, endAfterLine: outcomeStep >= 0 ? outcomeStep + 1 : null, events: committed(),
    progress: steps.map(s => s.reported?.progress), closingLine: steps.find(s => s.closingUsed)?.spoken };
  const mismatches: string[] = [];
  if (actual.endReason !== script.expected.endReason) mismatches.push(`endReason ${script.expected.endReason}→${actual.endReason}`);
  if (actual.finalRouteId !== script.expected.finalRouteId) mismatches.push(`finalRoute ${script.expected.finalRouteId}→${actual.finalRouteId}`);
  if (actual.endAfterLine !== script.expected.endAfterLine) mismatches.push(`endAfterLine ${script.expected.endAfterLine}→${actual.endAfterLine}`);
  if (actual.events.join(" ") !== script.expected.events.join(" ")) mismatches.push(`events [${script.expected.events.join(" ")}]→[${actual.events.join(" ")}]`);
  script.expected.progress.forEach((p, i) => { if (steps[i] && actual.progress[i] !== p) mismatches.push(`progress L${i + 1} ${p}→${actual.progress[i] ?? "missing"}`); });
  if (actual.closingLine && /\?/.test(actual.closingLine)) mismatches.push("closing line asks a question");
  if (script.expected.endReason === "no_progress_failed" && !actual.closingLine) mismatches.push("no closing line");
  for (const s of steps) if (s.droppedEvents.length) mismatches.push(`L${s.line} validator dropped ${s.droppedEvents.join(",")}`);
  if (aborted) mismatches.push(`aborted: ${aborted}`);

  // End-of-mission evaluation, once per dialogue, with the same entry point the server uses.
  let evaluation: EvaluationRun | null = null;
  evalRaw = [];
  // An aborted dialogue (provider failure) is not a learner ending; evaluating it would only spend calls.
  if (!aborted && snapshot.turns.some(t => t.role === "user")) {
    try {
      evaluation = await evaluateMission(snapshot, { ...mission!, missionMode: "real", languageLevel: script.level, missionEndReason: endReason, finalRouteId },
        { signal: AbortSignal.timeout(20 * 60_000), totalTimeoutMs: 20 * 60_000, attemptTimeoutMs: 10 * 60_000,
          generate: (request, signal) => gated(`${script.id}:evaluation`, async () => {
            const text = await evalGenerateRaw(request, signal);
            evalRaw.push((() => { try { return JSON.parse(text); } catch { return text; } })());
            return text;
          }) });
    } catch (error) { if (!(error instanceof CallBudgetExhausted)) throw error; }
  }
  if (!evaluation) mismatches.push(aborted ? "evaluation skipped (aborted)" : "evaluation unsettled");
  return { id: script.id, title: script.title, level: script.level, expected: script.expected, steps, actual, mismatches, snapshot, evaluation, evaluationRaw: evalRaw, aborted };
}

const outDir = `.local/mission-dialogue-real/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/scripts.json`, JSON.stringify({ model: "gemini-3.5-flash-lite", evaluationModel: NOTE_EXTRACTION_MODEL, gapMs: GAP_MS, maxCalls: MAX_CALLS, scripts: selected }, null, 2));
const results: DialogueResult[] = [];
for (const script of selected) {
  if (calls >= MAX_CALLS) { console.log(`call budget ${MAX_CALLS} reached; skipping ${script.id}`); continue; }
  console.log(`--- ${script.id} (${script.level}) ${script.title}`);
  let result: DialogueResult;
  try { result = await runDialogue(script); }
  catch (error) {
    console.log(`${script.id}: stopped (${error instanceof CallBudgetExhausted ? "budget" : statusOf(error)})`);
    continue;
  }
  results.push(result);
  writeFileSync(`${outDir}/${script.id}.json`, JSON.stringify(result, null, 2));
  const score = result.evaluation ? `${result.evaluation.score.totalEarnedHalf / 2}/${result.evaluation.score.totalMaxHalf / 2}` : "unsettled";
  console.log(`${script.id}: end=${result.actual.endReason} route=${result.actual.finalRouteId} line=${result.actual.endAfterLine} score=${score} mismatches=${result.mismatches.join(" | ") || "none"}`);
}

const verdictLabel: Record<string, string> = { met: "충족", partial: "부분", unmet: "미충족", undeterminable: "판정불가" };
const report = [`# 미션 실전 대화 실제 공급자 점검 ${outDir}`, "",
  `상대역 gemini-3.5-flash-lite(cascadeText, 실전) · 평가 ${NOTE_EXTRACTION_MODEL} · 호출 ${calls}/${MAX_CALLS} · 오류 ${JSON.stringify(errorKinds)} · 최소 간격 ${GAP_MS}ms · 토큰(보고 ${tokens.reported}회) 입력 ${tokens.prompt}·출력 ${tokens.output}·생각 ${tokens.thoughts}`, "",
  "| 대화 | 수준 | 기대 종료/경로/줄 | 실제 종료/경로/줄 | 실제 이벤트 | 점수 | 불일치 |", "| --- | --- | --- | --- | --- | --- | --- |"];
for (const r of results) report.push(`| ${r.id} | ${r.level} | ${r.expected.endReason}/${r.expected.finalRouteId}/${r.expected.endAfterLine} | ${r.actual.endReason}/${r.actual.finalRouteId}/${r.actual.endAfterLine} | ${r.actual.events.join(" ")} | ${r.evaluation ? `${r.evaluation.score.totalEarnedHalf / 2}/${r.evaluation.score.totalMaxHalf / 2}` : "미확정"} | ${r.mismatches.join("; ") || "없음"} |`);
for (const r of results) {
  report.push("", `## ${r.id} · ${r.title} (${r.level})`, "");
  for (const s of r.steps) report.push(`- L${s.line} 학습자: ${s.learner}`, `  - 직원${s.closingUsed ? "(마무리)" : ""}: ${s.spoken ?? "-"}`,
    `  - 보고: progress=${s.reported?.progress ?? "-"} events=${(s.reported?.routeEvents ?? []).map(e => `${e.kind}:${e.routeId}`).join(",") || "∅"} · 반영 ${s.committedEventsAdded.join(",") || "∅"} · 무진전 ${s.noProgressCount} · 예고 ${s.preview ?? "-"}${s.outcomeAfter ? ` · 종료 ${s.outcomeAfter}` : ""}`);
  if (r.evaluation) {
    report.push("", "| 기준 | 판정 | 사유 |", "| --- | --- | --- |");
    for (const j of r.evaluation.judgements) report.push(`| ${j.criterionId} | ${verdictLabel[j.verdict]} | ${j.reason.replace(/\|/g, "/")} |`);
  }
}
writeFileSync(`${outDir}/calls.json`, JSON.stringify({ calls, maxCalls: MAX_CALLS, errorKinds, tokens, callLog }, null, 2));
writeFileSync(`${outDir}/REPORT.md`, report.join("\n"));
console.log(JSON.stringify({ calls, maxCalls: MAX_CALLS, errorKinds, tokens, outputs: outDir }, null, 2));
