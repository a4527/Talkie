/**
 * Coverage check for the mission partner's single reply (follow-up to eval-mission-partner.ts, 2026-11-16).
 * - Speaking-level shape for all five levels (A1·A2·B1·B2·C).
 * - Problem-only openings in wordings NOT used while the partner instruction was tuned: does the staff member
 *   offer resolutions before the learner asks?
 * - Direct requests for one resolution (refund / remake, new wordings): does the reply bring up the other,
 *   unrequested resolution, and does it state conditions and ask instead of confirming?
 * Scenarios and expectations are fixed here before any call and written to the output folder first.
 * Split-mode text reply only (no speech synthesis, no Live). Fictional text only; needs the free-project opt-in.
 * Heuristic labels only — every reply is saved to .local/mission-partner-coverage/ for reading by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cascadeText } from "../src/server/voice-cascade";
import { currentMission, LANGUAGE_LEVELS, type LanguageLevel } from "../src/mission/definitions";
import type { ConversationSnapshot, Turn } from "../src/learning/types";

if (process.env.TALKIE_MISSION_EVAL !== "gemini-free" || process.env.GEMINI_FREE_TIER_CONFIRMED !== "true") {
  console.error("Set TALKIE_MISSION_EVAL=gemini-free and GEMINI_FREE_TIER_CONFIRMED=true (free local test project only).");
  process.exit(2);
}
process.env.TALKIE_VOICE_CASCADE_TEST = "enabled";
process.env.SONIOX_API_KEY ||= "unused-by-partner-eval";

const mission = currentMission("cafe-wrong-order");
if (!mission) throw new Error("mission definition missing");
const repeats = Number(process.env.TALKIE_PARTNER_EVAL_REPEATS ?? 2);
const maxCalls = Number(process.env.TALKIE_PARTNER_EVAL_MAX_CALLS ?? 70);
const gapMs = Math.max(20_000, Number(process.env.TALKIE_PARTNER_EVAL_GAP_MS ?? 20_000)); // shared free project: never below 20 s
const levels = (process.env.TALKIE_PARTNER_EVAL_LEVELS?.split(",") ?? ["A1", "A2", "B1", "B2", "C"]).filter((l): l is LanguageLevel => (LANGUAGE_LEVELS as readonly string[]).includes(l));

const t = (n: number, role: Turn["role"], text: string): Turn => ({ turnId: `c${n}`, requestId: `c${n}`, role, text });
const GREETING = t(1, "assistant", "Hi. How can I help?");
type Expectation =
  | { kind: "ask_without_proposing" }
  | { kind: "requested_route_only"; route: "remake" | "refund" }
  | { kind: "reask_after_reason" };
// None of these learner wordings appear in eval-mission-partner.ts or were used while tuning the instruction.
const SCENARIOS: { id: string; title: string; turns: Turn[]; expect: Expectation }[] = [
  { id: "np-short", title: "문제만 말함(짧은 쉬운 문장 셋)", expect: { kind: "ask_without_proposing" },
    turns: [GREETING, t(2, "user", "Sorry, this latte is cold. I ordered a hot one. And it should be decaf.")] },
  { id: "np-long", title: "문제만 말함(긴 설명)", expect: { kind: "ask_without_proposing" },
    turns: [GREETING, t(2, "user", "Hi, I just picked this up at the counter, but it doesn't look like what I ordered. I wanted a decaf latte, hot, and this seems to be an iced latte with regular coffee.")] },
  { id: "np-after-ask", title: "직원이 무엇이 문제인지 물은 뒤 문제만 답함", expect: { kind: "ask_without_proposing" },
    turns: [GREETING, t(2, "user", "Excuse me, there's a problem with my drink."), t(3, "assistant", "Oh, I'm sorry. What's wrong with it?"),
      t(4, "user", "The label says iced latte, and it tastes like normal coffee. But I paid for a hot decaf latte.")] },
  { id: "req-refund", title: "처음부터 환불을 요청함(새 표현)", expect: { kind: "requested_route_only", route: "refund" },
    turns: [GREETING, t(2, "user", "My latte is wrong. It's cold and it's not decaf, but I ordered it hot and decaf. Could you refund it?")] },
  { id: "req-money-back", title: "'refund' 없이 돈을 돌려 달라고 함", expect: { kind: "requested_route_only", route: "refund" },
    turns: [GREETING, t(2, "user", "This should be a hot decaf latte, but it's iced and has caffeine. I'd just like my money back, please.")] },
  { id: "req-remake", title: "처음부터 재제조를 요청함(새 표현)", expect: { kind: "requested_route_only", route: "remake" },
    turns: [GREETING, t(2, "user", "Sorry, I got an iced regular latte, but I ordered a hot decaf one. Can you make it again, hot and decaf?")] },
  // DEC-093: after options, a reason without a named route must not be narrowed to one route.
  { id: "reason-only", title: "선택지 안내 뒤 사정만 말함", expect: { kind: "reask_after_reason" },
    turns: [GREETING, t(2, "user", "Excuse me, my drink is wrong. It's cold and it has caffeine."),
      t(3, "assistant", "I'm sorry about that. What would you like me to do?"), t(4, "user", "Hmm, what can you do?"),
      t(5, "assistant", "We can make a new one. Or we can give you a refund. Which one?"), t(6, "user", "Well, my bus leaves soon.")] },
];
const only = process.env.TALKIE_PARTNER_EVAL_ONLY?.split(",");
const selectedScenarios = SCENARIOS.filter(s => !only || only.includes(s.id));

const REMAKE = /\bremak|\bremade|\bmake (?:you |it )?(?:a )?(?:new|another|fresh)|\bmake (?:it|one) again|\bnew (?:one|drink|latte)|\breplace|\banother (?:one|drink|latte)/i;
const REFUND = /\brefund|\bcancel|\bmoney back|\bpay you back|\breturn (?:your|the) (?:money|payment)/i;
const DECIDED = /\bI(?:'ll| will) (?:go ahead and )?(?:remake|cancel|refund|make|get|prepare|process|give)|\blet me (?:remake|cancel|refund|make|get|process)|\bwe(?:'ll| will) (?:remake|cancel|refund|make|process|give)/i;
const CONDITIONS: Record<"remake" | "refund", RegExp> = {
  remake: /\b(?:free|no (?:extra )?(?:charge|cost)|charge|minute|wait)/i,
  refund: /\b(?:full|no (?:fee|charge|cost)|fee|charge|cancel|all (?:of )?your money|whole)/i,
};

function classify(scenario: (typeof SCENARIOS)[number], text: string, events: { kind: string; routeId: string }[]) {
  const remake = REMAKE.test(text), refund = REFUND.test(text), kinds = events.map(e => e.kind);
  const problems: string[] = [];
  if (scenario.expect.kind === "ask_without_proposing") {
    if (remake || refund || kinds.includes("proposed")) problems.push(remake && refund ? "unasked_options" : "unasked_proposal");
    if (DECIDED.test(text) || kinds.includes("staff_confirmed")) problems.push("decided_for_learner");
  } else if (scenario.expect.kind === "reask_after_reason") {
    if (remake !== refund || kinds.includes("proposed")) problems.push("narrowed_to_one");
    if (DECIDED.test(text) || kinds.includes("staff_confirmed") || kinds.includes("user_accepted")) problems.push("decided_for_learner");
    if (!text.includes("?")) problems.push("no_question");
  } else {
    const route = scenario.expect.route, other = route === "remake" ? "refund" : "remake";
    if (route === "refund" ? remake : refund) problems.push("other_route_offered");
    if (events.some(e => e.routeId === other && (e.kind === "proposed" || e.kind === "staff_confirmed"))) problems.push("other_route_event");
    if (DECIDED.test(text)) problems.push("confirm_wording");
    if (kinds.includes("staff_confirmed") || kinds.includes("user_accepted")) problems.push("confirmed_before_conditions_accepted");
    if (!CONDITIONS[route].test(text)) problems.push("conditions_missing");
    if (!text.includes("?")) problems.push("no_question");
  }
  return problems;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = `.local/mission-partner-coverage/${stamp}`;
mkdirSync(outDir, { recursive: true });
// Fix scenarios and expectations on disk before the first call.
writeFileSync(`${outDir}/plan.json`, JSON.stringify({ fixedAt: new Date().toISOString(), mode: "real", levels, repeats, maxCalls, gapMs,
  model: "split-mode cascadeText (gemini-3.5-flash-lite)", scenarios: selectedScenarios }, null, 2));

type Row = { level: string; scenario: string; run: number; attempt: number; text?: string; events?: { kind: string; routeId: string }[]; progress?: unknown; problems: string[]; error?: string };
let calls = 0, nextStart = 0;
const errors: Record<string, number> = {};
const rows: Row[] = [];
const jobs: { level: LanguageLevel; scenario: (typeof SCENARIOS)[number]; run: number }[] = [];
// Interleave levels so a budget cut leaves the levels balanced.
for (let run = 1; run <= repeats; run++) for (const scenario of selectedScenarios) for (const level of levels) jobs.push({ level, scenario, run });
const retry: typeof jobs = [];

async function attempt(job: (typeof jobs)[number], attemptNo: number) {
  const wait = Math.max(0, nextStart - Date.now());
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  calls++;
  const snapshot: ConversationSnapshot = { turns: job.scenario.turns, corrections: [], learningState: "conversation" };
  try {
    const reply = await cascadeText(snapshot, undefined, false, AbortSignal.timeout(60_000), fetch, undefined,
      { definition: mission!.definition, missionMode: "real", languageLevel: job.level });
    const events = reply.missionReport?.routeEvents ?? [];
    const problems = classify(job.scenario, reply.text, events);
    rows.push({ level: job.level, scenario: job.scenario.id, run: job.run, attempt: attemptNo, text: reply.text, events, progress: reply.missionReport?.progress, problems });
    console.log(`[${calls}] ${job.level} ${job.scenario.id} #${job.run}: ${problems.join(",") || "ok"} | ${reply.text.replace(/\s+/g, " ").slice(0, 200)}`);
    return true;
  } catch (error) { // Kind only, never the body.
    const kind = String((error as { upstreamStatus?: unknown }).upstreamStatus ?? (error as { code?: unknown }).code ?? "unknown");
    errors[kind] = (errors[kind] ?? 0) + 1;
    rows.push({ level: job.level, scenario: job.scenario.id, run: job.run, attempt: attemptNo, problems: ["call_failed"], error: kind });
    console.log(`[${calls}] ${job.level} ${job.scenario.id} #${job.run}: call_failed ${kind}`);
    return false;
  } finally {
    nextStart = Date.now() + gapMs;
    writeFileSync(`${outDir}/results.json`, JSON.stringify({ calls, errors, rows }, null, 2));
  }
}

for (const job of jobs) {
  if (calls >= maxCalls) { console.log(`call budget ${maxCalls} reached`); break; }
  if (!(await attempt(job, 1))) retry.push(job);
}
for (const job of retry) { // Retries only within the same budget, after the main pass.
  if (calls >= maxCalls) { console.log(`call budget ${maxCalls} reached before retries finished`); break; }
  await attempt(job, 2);
}

const ok = rows.filter(r => r.text !== undefined);
const summary: Record<string, Record<string, string>> = {};
for (const r of ok) {
  const cell = (summary[r.scenario] ??= {})[r.level] ?? "";
  summary[r.scenario][r.level] = `${cell}${cell ? " " : ""}${r.problems.length ? r.problems.join("+") : "ok"}`;
}
// Speaking-level shape per level: length only, not a quality judgement.
const sentences = (text: string) => text.split(/(?<=[.?!])\s+/).map(x => x.trim()).filter(Boolean);
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const shapeOf = (texts: string[]) => {
  const avg = (f: (t: string) => number) => texts.length ? Math.round(texts.reduce((a, t) => a + f(t), 0) / texts.length * 10) / 10 : 0;
  return { replies: texts.length, avgWords: avg(words), avgSentences: avg(t => sentences(t).length),
    avgLongestSentence: avg(t => Math.max(...sentences(t).map(words))), relativeClauses: texts.filter(t => /,\s*which\b/i.test(t)).length };
};
const shape: Record<string, ReturnType<typeof shapeOf>> = {};
const shapeByKind: Record<string, Record<string, ReturnType<typeof shapeOf>>> = {};
for (const level of levels) {
  shape[level] = shapeOf(ok.filter(r => r.level === level).map(r => r.text!));
  for (const kind of ["ask_without_proposing", "requested_route_only", "reask_after_reason"]) {
    const ids = new Set(selectedScenarios.filter(s => s.expect.kind === kind).map(s => s.id));
    (shapeByKind[kind] ??= {})[level] = shapeOf(ok.filter(r => r.level === level && ids.has(r.scenario)).map(r => r.text!));
  }
}
const result = { calls, errors, summary, shape, shapeByKind, outputs: outDir };
writeFileSync(`${outDir}/results.json`, JSON.stringify({ ...result, rows }, null, 2));
console.log(JSON.stringify(result, null, 2));
