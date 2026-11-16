/**
 * Real-provider check of the mission partner in PRACTICE mode (PRD 4.2 / 4.3, MISSIONS 연습 모드).
 * Multi-turn: fixed learner scripts are fed through the app's own CascadeAdapter (fake STT/TTS, real
 * split-mode text via cascadeText) and the browser-side VoiceLearningRecords with the mission validator,
 * so correction acceptance, route events and automatic ending are decided by app code, not this script.
 * Learner scripts and expected behaviour below were fixed before the first run.
 * Fictional text only, no speech synthesis; needs the explicit free-project opt-in.
 * Heuristic labels only — raw model output, tool reports and app verdicts go to .local/mission-dialogue-practice/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cascadeText } from "../src/server/voice-cascade";
import { currentMission, type LanguageLevel } from "../src/mission/definitions";
import { CascadeAdapter } from "../src/voice/adapters/cascade";
import { parseVoiceLearningResult, VoiceLearningRecords } from "../src/voice/learning";
import { parseMissionStateReport, type MissionStateReport } from "../src/mission/realtime";
import type { RecognitionEvent } from "../src/voice/cascade/providers";
import type { VoiceEvent } from "../src/voice/port";
import type { ConversationSnapshot, Turn } from "../src/learning/types";

if (process.env.TALKIE_MISSION_EVAL !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
  console.error("Set TALKIE_MISSION_EVAL=gemini-free and GEMINI_FREE_TIER_CONFIRMED=true (free local test project only).");
  process.exit(2);
}
process.env.TALKIE_VOICE_CASCADE_TEST = "enabled";
process.env.SONIOX_API_KEY ||= "unused-by-practice-eval";

const mission = currentMission("cafe-wrong-order");
if (!mission) throw new Error("mission definition missing");
const MODEL_CALL_CAP = Number(process.env.TALKIE_PRACTICE_EVAL_MAX_CALLS ?? 60);
const BASE_GAP_MS = Math.max(20_000, Number(process.env.TALKIE_PRACTICE_EVAL_GAP_MS ?? 20_000));
const only = process.env.TALKIE_PRACTICE_EVAL_ONLY?.split(",");

// ---------------------------------------------------------------- fixed scripts and expectations
type Kind = "proposed" | "user_accepted" | "staff_confirmed" | "route_changed";
interface Expect {
  /** Learner-visible behaviour the reply should show (read by hand; some have heuristics). */
  note: string;
  correction?: "expected" | "not_expected";
  help?: "korean_or_easy_english" | "teach_refund";
  /** The partner must not offer resolution options in this reply (learner has not asked how / not said they don't know). */
  noUnaskedOptions?: boolean;
  /** Options asked for: both allowed resolutions, not picked for the learner. */
  bothOptionsNoChoice?: boolean;
  /** Conditions of the chosen route, no confirmation yet. */
  conditionsNoConfirm?: boolean;
  requiredEvents?: Kind[];
  forbiddenEvents?: Kind[];
  /** The reply should move on rather than insist on a repeat. */
  proceedsWithoutRetry?: boolean;
}
interface ScriptTurn { text: string; expect: Expect; /** Sent only if the mission has not ended yet (fixed fallback). */ ifNotEnded?: boolean }
interface Dialogue { id: string; title: string; level: LanguageLevel; turns: ScriptTurn[]; expectEnd: "goal_completed"; route: "remake" | "refund" }

const NO_CLOSE: Kind[] = ["user_accepted", "staff_confirmed"];
const remakeGrammar = (level: LanguageLevel): Dialogue => ({
  id: `a-grammar-remake-${level}`, title: "(a) 문법 오류가 섞인 발화로 재제조 완료", level, route: "remake", expectEnd: "goal_completed",
  turns: [
    { text: "Excuse me. I order a hot decaf latte, but this drink is iced and it have caffeine.",
      expect: { note: "문제 접수·사과, 원하는 처리만 물음(선택지 먼저 꺼내지 않음). 문법 교정 하나(order→ordered 또는 have→has).", correction: "expected", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "I want a new one. Can you make again?",
      expect: { note: "재제조 조건(무료·약 5분·따뜻한 디카페인)을 말하고 괜찮은지 물음. 확정하지 않음.", conditionsNoConfirm: true, requiredEvents: ["proposed"], forbiddenEvents: NO_CLOSE } },
    { text: "Yes, is okay. I can wait.",
      expect: { note: "동의→확정·짧은 마무리. user_accepted+staff_confirmed, 자동 종료.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
    { text: "Okay. A hot decaf latte, about five minutes. That's fine.", ifNotEnded: true,
      expect: { note: "(대체 턴) 앞 턴에서 끝나지 않았을 때만. 동의→확정.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
  ],
});
const DIALOGUES: Dialogue[] = [
  remakeGrammar("A1"), remakeGrammar("B1"), remakeGrammar("C"),
  { id: "b-help-refund-B1", title: "(b) 중간에 '환불'을 영어로 묻는 도움 요청", level: "B1", route: "refund", expectEnd: "goal_completed", turns: [
    { text: "Hi, I ordered a hot decaf latte, but this one is iced and it's regular coffee.",
      expect: { note: "사과·원하는 처리 질문. 선택지 먼저 꺼내지 않음.", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "How do I say 환불 in English?",
      expect: { note: "역할 잠시 벗어나 'refund'를 쉬운 영어/짧은 한국어로 알려 주고 역할로 복귀. 대신 환불을 요청·확정하지 않음.", help: "teach_refund", forbiddenEvents: NO_CLOSE } },
    { text: "Okay. I'd like a refund, please.",
      expect: { note: "환불 조건(취소·전액 환불·수수료 없음) 안내 후 괜찮은지 물음. 확정하지 않음.", conditionsNoConfirm: true, requiredEvents: ["proposed"], forbiddenEvents: NO_CLOSE } },
    { text: "Yes, that's fine.", expect: { note: "확정·마무리, 자동 종료.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
    { text: "Yes, please cancel it and refund me.", ifNotEnded: true, expect: { note: "(대체 턴) 동의→확정.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
  ] },
  { id: "c-stuck-korean-A1", title: "(c) 한국어로 '모르겠어요'라고 막힘", level: "A1", route: "remake", expectEnd: "goal_completed", turns: [
    { text: "Hello. This... wrong drink.",
      expect: { note: "무엇이 잘못됐는지 묻기(주문 내용·차이를 추측하지 않음).", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "음... 모르겠어요.",
      expect: { note: "역할을 잠시 벗어나 짧은 한국어/쉬운 영어로 말할 틀을 도움(예: 'I ordered ...'). 처리 선택지를 꺼내거나 대신 고르지 않음.", help: "korean_or_easy_english", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "I ordered hot decaf latte. This is cold. And not decaf.",
      expect: { note: "사과·원하는 처리 질문. 선택지 먼저 꺼내지 않음.", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "I don't know. What can I do?",
      expect: { note: "두 처리 모두 짧게 안내하고 고르지 않음(A1: 조건 없이).", bothOptionsNoChoice: true, forbiddenEvents: NO_CLOSE } },
    { text: "A new one, please.",
      expect: { note: "재제조 조건 안내·괜찮은지 물음. 확정하지 않음.", conditionsNoConfirm: true, requiredEvents: ["proposed"], forbiddenEvents: NO_CLOSE } },
    { text: "Yes. Okay.", expect: { note: "확정·마무리, 자동 종료.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
    { text: "Yes, okay. I can wait five minutes.", ifNotEnded: true, expect: { note: "(대체 턴) 동의→확정.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
  ] },
  { id: "d-no-retry-C", title: "(d) 교정 뒤 다시 말하기를 하지 않고 진행", level: "C", route: "remake", expectEnd: "goal_completed", turns: [
    { text: "Hi, I was ordered a hot decaf latte, but this is iced and have caffeine.",
      expect: { note: "교정 하나(I was ordered→I ordered 등). 다시 말하기 요청 가능. 선택지 먼저 꺼내지 않음.", correction: "expected", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "Can I just get a new one made?",
      expect: { note: "다시 말하기를 강요·차단하지 않고 재제조 조건 안내·괜찮은지 물음. 재시도 성공으로 꾸미지 않음.", proceedsWithoutRetry: true, conditionsNoConfirm: true, requiredEvents: ["proposed"], forbiddenEvents: NO_CLOSE } },
    { text: "Sure, that works.", expect: { note: "확정·마무리, 자동 종료.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
    { text: "Yes, a hot decaf remake in five minutes is fine.", ifNotEnded: true, expect: { note: "(대체 턴) 동의→확정.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
  ] },
  { id: "e-no-progress-A2", title: "(e) 진전 없는 답을 여러 번 해도 실패로 끝나지 않음", level: "A2", route: "refund", expectEnd: "goal_completed", turns: [
    { text: "Hi. My drink is wrong. I ordered a hot decaf latte, but this is iced and regular.",
      expect: { note: "사과·원하는 처리 질문.", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
    { text: "Um... the weather is nice today.", expect: { note: "진전 없음 1: 실패 종료 없음, 부드럽게 원래 질문으로 되돌리거나 도움.", forbiddenEvents: NO_CLOSE } },
    { text: "I like the music here.", expect: { note: "진전 없음 2: 실패 종료 없음, 도움 제공 가능.", forbiddenEvents: NO_CLOSE } },
    { text: "Hmm, okay.", expect: { note: "진전 없음 3(실전 시험 임계값 3): 연습이므로 종료되지 않아야 함.", forbiddenEvents: NO_CLOSE } },
    { text: "Sorry. I want a refund, please.", expect: { note: "환불 조건 안내·괜찮은지 물음.", conditionsNoConfirm: true, requiredEvents: ["proposed"], forbiddenEvents: NO_CLOSE } },
    { text: "Yes, okay.", expect: { note: "확정·마무리, 자동 종료.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
    { text: "Yes. Cancel it and refund, please. Okay.", ifNotEnded: true, expect: { note: "(대체 턴) 동의→확정.", requiredEvents: ["user_accepted", "staff_confirmed"] } },
  ] },
];

// Single-reply situations from eval-mission-partner.ts, rerun in practice mode (turn text copied; that file is not imported).
const h = (n: number, role: Turn["role"], text: string): Turn => ({ turnId: `p${n}`, requestId: `p${n}`, role, text });
const GREETING = h(1, "assistant", "Hi. How can I help?");
interface Single { id: string; title: string; level: LanguageLevel; history: Turn[]; last: string; expect: Expect }
const SINGLES: Single[] = [
  { id: "s-vague-B1", title: "문제를 모호하게 말함", level: "B1", history: [GREETING], last: "This not my drink.",
    expect: { note: "무엇이 잘못됐는지 묻기, 조건 추측·선택지 없음. 문법 교정 가능.", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
  { id: "s-no-request-B1", title: "문제만 말하고 처리는 요청하지 않음", level: "B1", history: [GREETING], last: "I ordered a hot decaf latte, but this is iced and regular.",
    expect: { note: "사과·원하는 처리만 물음.", correction: "not_expected", noUnaskedOptions: true, forbiddenEvents: ["proposed", ...NO_CLOSE] } },
  { id: "s-delegate-A1", title: "원하는 처리를 직원에게 맡김", level: "A1",
    history: [GREETING, h(2, "user", "I ordered a hot decaf latte, but this is iced and regular."), h(3, "assistant", "I'm sorry about that. What would you like me to do?")],
    last: "I don't know. You choose.", expect: { note: "두 처리 모두 안내, 대신 고르지 않음.", bothOptionsNoChoice: true, forbiddenEvents: NO_CLOSE } },
  { id: "s-delegate-B1", title: "원하는 처리를 직원에게 맡김", level: "B1",
    history: [GREETING, h(2, "user", "I ordered a hot decaf latte, but this is iced and regular."), h(3, "assistant", "I'm sorry about that. What would you like me to do?")],
    last: "I don't know. You choose.", expect: { note: "두 처리 모두 안내, 대신 고르지 않음.", bothOptionsNoChoice: true, forbiddenEvents: NO_CLOSE } },
  { id: "s-ask-refund-C", title: "처음부터 환불을 요청함", level: "C", history: [GREETING],
    last: "Hi, this is iced and has caffeine, but I ordered a hot decaf latte. Can I get a refund, please?",
    expect: { note: "환불 조건 안내·괜찮은지 물음, 확정하지 않음.", conditionsNoConfirm: true, requiredEvents: ["proposed"], forbiddenEvents: NO_CLOSE } },
];

// ---------------------------------------------------------------- heuristics (labels only)
const REMAKE = /\bremake|\bmake (?:you |it )?(?:a )?(?:new|another|fresh)|\bnew (?:one|drink|latte)|\breplace/i;
const REFUND = /\brefund|\bcancel/i;
const DECIDED = /\bI(?:'ll| will) (?:go ahead and )?(?:remake|cancel|refund|make|get|prepare)|\blet me (?:remake|cancel|refund|make|get)/i;
const CONDITIONS = /\b(?:free|charge|minute|fee|full refund|no cost|cost)/i;
const HANGUL = /[가-힣]/;
const RETRY_ASK = /\b(?:try (?:saying|again)|say (?:it|that) again|repeat|can you say)/i;

function label(expect: Expect, text: string, kinds: Kind[], correctionAccepted: boolean, correctionOffered: boolean) {
  const problems: string[] = [];
  for (const k of expect.requiredEvents ?? []) if (!kinds.includes(k)) problems.push(`missing_${k}`);
  for (const k of expect.forbiddenEvents ?? []) if (kinds.includes(k)) problems.push(`unexpected_${k}`);
  const remake = REMAKE.test(text), refund = REFUND.test(text);
  if (expect.noUnaskedOptions && (remake || refund)) problems.push(remake && refund ? "unasked_options" : "unasked_proposal");
  if (expect.bothOptionsNoChoice) { if (DECIDED.test(text)) problems.push("decided_for_learner"); else if (!(remake && refund)) problems.push("not_both_options"); }
  if (expect.conditionsNoConfirm) { if (!CONDITIONS.test(text)) problems.push("conditions_missing"); if (DECIDED.test(text)) problems.push("confirmed_before_acceptance"); }
  if (expect.help === "teach_refund" && !/\brefund\b/i.test(text)) problems.push("help_missing_refund");
  if (expect.help === "korean_or_easy_english" && !HANGUL.test(text) && !/I ordered|you can say|try saying/i.test(text)) problems.push("help_not_visible");
  if (expect.correction === "expected" && !correctionAccepted) problems.push(correctionOffered ? "correction_rejected_by_app" : "correction_missing");
  if (expect.correction === "not_expected" && correctionOffered) problems.push("unneeded_correction");
  if (expect.proceedsWithoutRetry && RETRY_ASK.test(text) && !CONDITIONS.test(text)) problems.push("insists_on_retry");
  return problems;
}

// ---------------------------------------------------------------- rate-limited provider path
class BudgetExhausted extends Error {}
let calls = 0, nextStart = 0, gapMs = BASE_GAP_MS, consecutiveLimited = 0;
/** Stop the whole run after this many 429/503 in a row so a shared free quota is not drained. */
const MAX_CONSECUTIVE_LIMITED = Number(process.env.TALKIE_PRACTICE_EVAL_MAX_LIMITED ?? 4);
const errors: Record<string, number> = {};
const callLog: { n: number; at: string; status: string; waitMs: number }[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type RawCapture = { modelText?: string; finishReason?: string; modelVersion?: string; usage?: unknown };

/** Same call as the server route (`cascadeText(context, prior, learning=true, …, mission, closing)`), with pacing and bounded retries. */
async function providerReply(context: ConversationSnapshot, level: LanguageLevel, closing: "no_progress" | undefined, captures: RawCapture[]) {
  for (let attempt = 0; ; attempt++) {
    if (calls >= MODEL_CALL_CAP || consecutiveLimited >= MAX_CONSECUTIVE_LIMITED) throw new BudgetExhausted();
    const wait = Math.max(0, nextStart - Date.now());
    if (wait) await sleep(wait);
    calls++;
    let raw: RawCapture = {};
    // Response capture only; the request (and its key header) is never stored.
    const capturing: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok) {
        try { const body = await response.clone().json();
          raw = { modelText: body?.candidates?.[0]?.content?.parts?.[0]?.text, finishReason: body?.candidates?.[0]?.finishReason, modelVersion: body?.modelVersion, usage: body?.usageMetadata };
        } catch { /* left empty */ }
      }
      return response;
    };
    try {
      const reply = await cascadeText(context, undefined, true, AbortSignal.timeout(60_000), capturing, undefined,
        { definition: mission!.definition, missionMode: "practice", languageLevel: level }, closing);
      nextStart = Date.now() + gapMs;
      callLog.push({ n: calls, at: new Date().toISOString(), status: "ok", waitMs: wait });
      captures.push(raw);
      consecutiveLimited = 0;
      return reply;
    } catch (error) {
      nextStart = Date.now() + gapMs;
      const upstream = (error as { upstreamStatus?: unknown }).upstreamStatus;
      const kind = upstream !== undefined ? String(upstream) : raw.modelText !== undefined ? "invalid_model_output" : String((error as { code?: unknown }).code ?? "unknown");
      errors[kind] = (errors[kind] ?? 0) + 1;
      callLog.push({ n: calls, at: new Date().toISOString(), status: kind, waitMs: wait });
      captures.push({ ...raw, finishReason: `error:${kind}` });
      console.log(`  call ${calls} failed: ${kind}`);
      if (upstream === 429 || upstream === 503) consecutiveLimited++; else consecutiveLimited = 0;
      const retryable = upstream === 429 || upstream === 503 || kind === "invalid_model_output";
      if (!retryable || attempt >= 2) throw error;
      if (upstream === 429 || upstream === 503) { gapMs = Math.min(gapMs + 10_000, 60_000); nextStart = Date.now() + gapMs * (attempt + 2); }
    }
  }
}

// ---------------------------------------------------------------- app pipeline harness
interface TurnRecord {
  index: number; learner: string; fallbackTurn: boolean; expect: Expect;
  reply?: string; raw: RawCapture[];
  learningResult?: { provided: boolean; parsed?: unknown; dropped?: boolean };
  correction: { offered: boolean; acceptedByApp: boolean; whyRejected?: string };
  learningStateAfter?: string;
  missionReport?: MissionStateReport; reportProvided: boolean; reportDropped?: boolean; progressFieldSent?: unknown;
  committedEvents: string[]; advisor?: string;
  outcomeAfter?: unknown; problems: string[]; error?: string;
}

async function runConversation(id: string, level: LanguageLevel, history: Turn[], learnerTurns: ScriptTurn[]) {
  const restored: ConversationSnapshot = { turns: history, corrections: [], learningState: "conversation" };
  const records = new VoiceLearningRecords(restored, { missionMode: "practice", routeIds: mission!.definition.routes.map(r => r.routeId) });
  let sttEmit: ((event: RecognitionEvent) => void) | undefined;
  let waiter: ((event: VoiceEvent) => void) | undefined;
  let current: { captures: RawCapture[]; rawReply?: { learningResult?: unknown; missionReport?: unknown }; advisor?: string } = { captures: [] };
  const appEvents: VoiceEvent[] = [];
  const adapter: CascadeAdapter = new CascadeAdapter({
    stt: { async connect(emit) { sttEmit = emit; }, sendAudio() {}, close() {} },
    llm: { async respond(request, signal) {
      void signal;
      const reply = await providerReply(request.context, level, request.closing, current.captures);
      // Mirror what the route returns: the parsed reply as JSON. Keep the raw keys for diagnosis.
      const modelText = current.captures.at(-1)?.modelText;
      try { const parsed = modelText ? JSON.parse(modelText) : undefined; current.rawReply = { learningResult: parsed?.learningResult, missionReport: parsed?.missionReport }; } catch { current.rawReply = undefined; }
      return JSON.parse(JSON.stringify(reply));
    } },
    tts: { async *synthesize() { yield { pcm: new Uint8Array(4800), sampleRateHz: 24000 }; } },
  }, event => {
    // Same order as use-voice-learning: records first, then playback acknowledgement after completion.
    appEvents.push(event.type === "audio" ? { ...event, pcm: new Uint8Array(0) } : event);
    records.apply(event);
    if (event.type === "response-complete") { adapter.acknowledgePlayback(event.turnId); records.apply({ type: "played", turnId: event.turnId }); }
    waiter?.(event);
  }, { learning: true, missionMode: "practice", responseTimeoutMs: 900_000,
    missionAdvisor: (inputTurnId, report) => { const r = records.previewMissionEnding(inputTurnId, report); current.advisor = String(r); return r; } });
  await adapter.connect(records.getSnapshot(), undefined);

  const out: TurnRecord[] = [];
  let ended: string | undefined, failure: string | undefined;
  for (const [index, script] of learnerTurns.entries()) {
    // Fixed fallback turns sit at the end of a script, so they are reached only while the mission is still open.
    if (records.getMissionOutcome()) break;
    current = { captures: [] };
    const before = records.getSnapshot();
    const eventsBefore = new Set((before.missionProgress?.routeEvents ?? []).map(e => e.eventId));
    const done = new Promise<VoiceEvent>(resolve => { waiter = event => { if (["response-complete", "error", "closed"].includes(event.type)) resolve(event); }; });
    const utteranceId = `${id}-u${index}`;
    sttEmit!({ type: "speech-start", utteranceId });
    sttEmit!({ type: "final", utteranceId, text: script.text });
    const end = await done;
    waiter = undefined;
    const snap = records.getSnapshot();
    const userTurn = snap.turns.findLast(t => t.role === "user");
    const reply = end.type === "response-complete" ? snap.turns.at(-1) : undefined;
    const rec: TurnRecord = { index, learner: script.text, fallbackTurn: script.ifNotEnded === true, expect: script.expect, raw: current.captures,
      correction: { offered: false, acceptedByApp: false }, reportProvided: false, committedEvents: [], problems: [] };
    if (!reply || reply.role !== "assistant") {
      rec.error = end.type === "error" ? `adapter_${end.code}` : end.type;
      failure = rec.error; out.push(rec); break;
    }
    rec.reply = reply.text;
    const rawLR = current.rawReply?.learningResult, rawMR = current.rawReply?.missionReport;
    const parsedLR = rawLR === undefined ? undefined : parseVoiceLearningResult(rawLR);
    rec.learningResult = { provided: rawLR !== undefined, parsed: parsedLR, dropped: rawLR !== undefined && !parsedLR };
    rec.reportProvided = rawMR !== undefined;
    rec.missionReport = rawMR === undefined ? undefined : parseMissionStateReport(rawMR);
    rec.reportDropped = rawMR !== undefined && !rec.missionReport;
    rec.progressFieldSent = (rawMR as { progress?: unknown } | undefined)?.progress;
    rec.advisor = current.advisor;
    // App verdict on the correction: did VoiceLearningRecords add one for this reply?
    const added = snap.corrections.find(c => c.deliveredTurnId === reply.turnId);
    rec.correction.offered = Boolean(parsedLR?.replacement);
    rec.correction.acceptedByApp = Boolean(added);
    if (parsedLR?.replacement && !added) {
      rec.correction.whyRejected = userTurn && userTurn.text.trim() !== parsedLR.original.trim() ? "original_mismatch"
        : !reply.text.includes(parsedLR.replacement) ? "replacement_not_in_reply" : "other";
    }
    rec.learningStateAfter = snap.learningState;
    rec.committedEvents = (snap.missionProgress?.routeEvents ?? []).filter(e => !eventsBefore.has(e.eventId)).map(e => `${e.kind}:${e.routeId}`);
    rec.outcomeAfter = records.getMissionOutcome();
    const kinds = rec.committedEvents.map(e => e.split(":")[0] as Kind);
    rec.problems = label(script.expect, reply.text, kinds, rec.correction.acceptedByApp, rec.correction.offered);
    out.push(rec);
    console.log(`${id} t${index}${script.ifNotEnded ? "*" : ""}: ${rec.problems.join(",") || "ok"} | ev=[${rec.committedEvents.join(" ")}] corr=${rec.correction.offered ? (rec.correction.acceptedByApp ? "accepted" : `rejected(${rec.correction.whyRejected})`) : "-"} | ${reply.text.replace(/\s+/g, " ").slice(0, 200)}`);
    const outcome = records.getMissionOutcome();
    if (outcome) { ended = outcome.reason; break; } // The app stops the session after the played line.
  }
  adapter.close();
  return { turns: out, ended, failure, finalSnapshot: records.getSnapshot(), appEvents: appEvents.filter(e => e.type !== "audio") };
}

// ---------------------------------------------------------------- run
const outDir = `.local/mission-dialogue-practice/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/plan.json`, JSON.stringify({ fixedBeforeRun: true, model: "gemini-3.5-flash-lite (cascadeText)", mode: "practice", dialogues: DIALOGUES, singles: SINGLES, capCalls: MODEL_CALL_CAP, minGapMs: BASE_GAP_MS }, null, 2));
const results: Record<string, unknown>[] = [];
let transcript = "";
try {
  for (const d of DIALOGUES.filter(d => !only || only.includes(d.id))) {
    console.log(`== ${d.id} (${d.level}) ${d.title}`);
    const { turns, ended, failure, finalSnapshot, appEvents } = await runConversation(d.id, d.level, [], d.turns);
    results.push({ kind: "dialogue", id: d.id, title: d.title, level: d.level, expectedEnd: d.expectEnd, expectedRoute: d.route, ended: ended ?? "not_ended", failure, turns, finalSnapshot, appEvents });
    writeFileSync(`${outDir}/${d.id}.json`, JSON.stringify(results.at(-1), null, 2));
    transcript += `\n## ${d.id} (${d.level}) ${d.title}\n` + turns.map(t => `L${t.index}${t.fallbackTurn ? "*" : ""}: ${t.learner}\nS: ${t.reply ?? `<${t.error}>`}\n   events=[${t.committedEvents.join(" ")}] correction=${t.correction.offered ? JSON.stringify((t.learningResult?.parsed as { replacement?: string })?.replacement) + (t.correction.acceptedByApp ? " accepted" : ` rejected(${t.correction.whyRejected})`) : "-"} state=${t.learningStateAfter} problems=${t.problems.join(",") || "ok"}`).join("\n") + `\n=> ended: ${ended ?? "not_ended"}${failure ? ` failure=${failure}` : ""}\n`;
    if (calls >= MODEL_CALL_CAP || consecutiveLimited >= MAX_CONSECUTIVE_LIMITED) throw new BudgetExhausted();
  }
  for (const s of SINGLES.filter(s => !only || only.includes(s.id))) {
    console.log(`== ${s.id} (${s.level}) ${s.title}`);
    const r = await runConversation(s.id, s.level, s.history, [{ text: s.last, expect: s.expect }]);
    results.push({ kind: "single", id: s.id, title: s.title, level: s.level, ended: r.ended ?? "not_ended", failure: r.failure, turns: r.turns, history: s.history });
    writeFileSync(`${outDir}/${s.id}.json`, JSON.stringify(results.at(-1), null, 2));
    const t = r.turns[0];
    transcript += `\n## ${s.id} (${s.level}) ${s.title}\nL: ${s.last}\nS: ${t?.reply ?? `<${t?.error}>`}\n   events=[${t?.committedEvents.join(" ")}] correction=${t?.correction.offered ? t.correction.acceptedByApp ? "accepted" : `rejected(${t.correction.whyRejected})` : "-"} problems=${t?.problems.join(",") || "ok"}\n`;
    if (calls >= MODEL_CALL_CAP || consecutiveLimited >= MAX_CONSECUTIVE_LIMITED) throw new BudgetExhausted();
  }
} catch (error) {
  if (!(error instanceof BudgetExhausted)) throw error;
  console.log(consecutiveLimited >= MAX_CONSECUTIVE_LIMITED ? `stopped after ${consecutiveLimited} rate-limited calls in a row` : `call budget ${MODEL_CALL_CAP} reached`);
}

// Speaking-level shape (length only, not a quality judgement); replies containing Korean help are listed separately.
const sentences = (text: string) => text.split(/(?<=[.?!])\s+/).map(x => x.trim()).filter(Boolean);
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const shape: Record<string, unknown> = {};
for (const level of ["A1", "A2", "B1", "C"]) {
  const texts = results.filter(r => r.level === level).flatMap(r => (r.turns as TurnRecord[]).map(t => t.reply).filter((x): x is string => !!x));
  const english = texts.filter(t => !HANGUL.test(t));
  const avg = (f: (t: string) => number) => english.length ? Math.round(english.reduce((a, t) => a + f(t), 0) / english.length * 10) / 10 : 0;
  shape[level] = { replies: texts.length, englishOnly: english.length, avgWords: avg(words), avgSentences: avg(t => sentences(t).length),
    avgLongestSentence: avg(t => Math.max(...sentences(t).map(words))), withKorean: texts.length - english.length };
}
const summary = results.map(r => ({ id: r.id, level: r.level, ended: r.ended, failure: r.failure,
  turns: (r.turns as TurnRecord[]).map(t => `${t.index}${t.fallbackTurn ? "*" : ""}:${t.problems.join("+") || (t.error ? `error(${t.error})` : "ok")}`) }));
writeFileSync(`${outDir}/results.json`, JSON.stringify({ model: "gemini-3.5-flash-lite", mode: "practice", calls, errors, callLog, gapMsFinal: gapMs, summary, shape }, null, 2));
writeFileSync(`${outDir}/transcript.txt`, transcript);
console.log(JSON.stringify({ calls, errors, summary, shape, outputs: outDir }, null, 2));
