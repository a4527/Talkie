/**
 * Real-provider check of the mission partner's behaviour (PRD 4.2 / DEC-076): the staff member must not
 * complete a resolution the learner has not asked for, must not guess conditions the learner has not said,
 * and must not choose for the learner. Uses the split-mode text reply (same instruction as the voice path,
 * no speech synthesis). Fictional text only; needs the explicit free-project opt-in.
 * Heuristic labels only — every reply is saved to .local/mission-partner-eval/ for reading by hand.
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
const repeats = Number(process.env.TALKIE_PARTNER_EVAL_REPEATS ?? 3);
const maxCalls = Number(process.env.TALKIE_PARTNER_EVAL_MAX_CALLS ?? 36);
const gapMs = Number(process.env.TALKIE_PARTNER_EVAL_GAP_MS ?? 6000);
const levels = (process.env.TALKIE_PARTNER_EVAL_LEVELS?.split(",") ?? ["A1", "A2", "B1", "C"]).filter((l): l is LanguageLevel => (LANGUAGE_LEVELS as readonly string[]).includes(l));

const t = (n: number, role: Turn["role"], text: string): Turn => ({ turnId: `p${n}`, requestId: `p${n}`, role, text });
const GREETING = t(1, "assistant", "Hi. How can I help?");
type Expectation = "ask_without_proposing" | "offer_both_without_choosing" | "conditions_without_confirming";
const SCENARIOS: { id: string; title: string; turns: Turn[]; expect: Expectation }[] = [
  { id: "vague", title: "문제를 모호하게 말함", expect: "ask_without_proposing", turns: [GREETING, t(2, "user", "This not my drink.")] },
  { id: "no-request", title: "문제만 말하고 처리는 요청하지 않음", expect: "ask_without_proposing",
    turns: [GREETING, t(2, "user", "I ordered a hot decaf latte, but this is iced and regular.")] },
  { id: "delegate", title: "원하는 처리를 직원에게 맡김", expect: "offer_both_without_choosing",
    turns: [GREETING, t(2, "user", "I ordered a hot decaf latte, but this is iced and regular."), t(3, "assistant", "I'm sorry about that. What would you like me to do?"), t(4, "user", "I don't know. You choose.")] },
  // Added after the partner instruction was tightened (2026-11-16); not used while writing that rule.
  { id: "no-request-2", title: "문제만 말함(다른 표현)", expect: "ask_without_proposing",
    turns: [GREETING, t(2, "user", "Excuse me, I think there's a mistake. I asked for a hot latte with no caffeine, and this one is cold.")] },
  { id: "no-request-3", title: "짧게 문제만 말함", expect: "ask_without_proposing",
    turns: [GREETING, t(2, "user", "Wrong drink. Iced, not hot. And not decaf.")] },
  { id: "ask-how", title: "해결 방법을 물음", expect: "offer_both_without_choosing",
    turns: [GREETING, t(2, "user", "My hot decaf latte came iced and regular. What can you do about it?")] },
  // Added with the speaking-level rule (2026-11-16): after the learner picks, conditions come before confirmation.
  { id: "pick-remake", title: "선택지 중 재제조를 고름", expect: "conditions_without_confirming",
    turns: [GREETING, t(2, "user", "I ordered a hot decaf latte, but this is iced and regular."), t(3, "assistant", "I'm sorry about that. What would you like me to do?"),
      t(4, "user", "What can I do?"), t(5, "assistant", "We can make a new one. Or we can give you a refund. Which one?"), t(6, "user", "A new one, please.")] },
  // Added after the condition-before-confirmation rule (2026-11-16); not used while writing that rule.
  { id: "ask-refund", title: "처음부터 환불을 요청함", expect: "conditions_without_confirming",
    turns: [GREETING, t(2, "user", "Hi, this is iced and has caffeine, but I ordered a hot decaf latte. Can I get a refund, please?")] },
];
const only = process.env.TALKIE_PARTNER_EVAL_ONLY?.split(",");
const selectedScenarios = SCENARIOS.filter(s => !only || only.includes(s.id));

const REMAKE = /\bremake|\bmake (?:you |it )?(?:a )?(?:new|another|fresh)|\bnew (?:one|drink|latte)|\breplace/i;
const REFUND = /\brefund|\bcancel/i;
const DECIDED = /\bI(?:'ll| will) (?:go ahead and )?(?:remake|cancel|refund|make|get|prepare)|\blet me (?:remake|cancel|refund|make|get)/i;
const GUESSED = /\b(?:hot|iced|cold|decaf|regular|caffeine)\b/i;

function classify(scenario: (typeof SCENARIOS)[number], text: string, events: string[]) {
  const remake = REMAKE.test(text), refund = REFUND.test(text), decided = DECIDED.test(text) || events.includes("staff_confirmed");
  const problems: string[] = [];
  if (scenario.expect === "ask_without_proposing") {
    if (remake || refund || events.includes("proposed")) problems.push(remake && refund ? "unasked_options" : "unasked_proposal");
    if (decided) problems.push("decided_for_learner");
    if (scenario.id === "vague" && GUESSED.test(text)) problems.push("guessed_condition");
  } else if (scenario.expect === "conditions_without_confirming") {
    if (events.includes("staff_confirmed") || events.includes("user_accepted")) problems.push("confirmed_before_conditions_accepted");
    if (!/\b(?:free|charge|minute|fee|full refund|cancel)/i.test(text)) problems.push("conditions_missing");
  } else {
    if (decided) problems.push("decided_for_learner");
    else if (!(remake && refund)) problems.push("not_both_options");
  }
  return problems;
}

const outDir = `.local/mission-partner-eval/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(outDir, { recursive: true });
let calls = 0, nextStart = 0;
const errors: Record<string, number> = {};
const rows: { level: string; scenario: string; run: number; text?: string; events?: string[]; problems: string[] }[] = [];
outer: for (const level of levels) for (const scenario of selectedScenarios) for (let run = 1; run <= repeats; run++) {
  if (calls >= maxCalls) { console.log(`call budget ${maxCalls} reached`); break outer; }
  const wait = Math.max(0, nextStart - Date.now());
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  nextStart = Date.now() + gapMs; calls++;
  const snapshot: ConversationSnapshot = { turns: scenario.turns, corrections: [], learningState: "conversation" };
  try {
    const reply = await cascadeText(snapshot, undefined, false, AbortSignal.timeout(60_000), fetch, undefined,
      { definition: mission.definition, missionMode: "real", languageLevel: level });
    const events = reply.missionReport?.routeEvents.map(e => e.kind) ?? [];
    const problems = classify(scenario, reply.text, events);
    rows.push({ level, scenario: scenario.id, run, text: reply.text, events, problems });
    console.log(`${level} ${scenario.id} #${run}: ${problems.join(",") || "ok"} | ${reply.text.replace(/\s+/g, " ").slice(0, 160)}`);
  } catch (error) { // Kind only, never the body.
    const kind = String((error as { upstreamStatus?: unknown }).upstreamStatus ?? (error as { code?: unknown }).code ?? "unknown");
    errors[kind] = (errors[kind] ?? 0) + 1;
    rows.push({ level, scenario: scenario.id, run, problems: ["call_failed"] });
    console.log(`${level} ${scenario.id} #${run}: call_failed ${kind}`);
  }
}
writeFileSync(`${outDir}/results.json`, JSON.stringify({ mode: "real", levels, scenarios: SCENARIOS, rows }, null, 2));
const summary: Record<string, Record<string, string>> = {};
for (const r of rows) {
  const cell = (summary[r.scenario] ??= {})[r.level] ?? "";
  summary[r.scenario][r.level] = `${cell}${cell ? " " : ""}${r.problems.length ? r.problems.join("+") : "ok"}`;
}
// Speaking-level shape per level (PRD 4.1 / MISSIONS 수준별 설명): length only, not a quality judgement.
const sentences = (text: string) => text.split(/(?<=[.?!])\s+/).map(x => x.trim()).filter(Boolean);
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const shape: Record<string, { replies: number; avgWords: number; avgSentences: number; avgLongestSentence: number; relativeClauses: number }> = {};
for (const level of levels) {
  const texts = rows.filter(r => r.level === level && r.text).map(r => r.text!);
  const avg = (f: (t: string) => number) => texts.length ? Math.round(texts.reduce((a, t) => a + f(t), 0) / texts.length * 10) / 10 : 0;
  shape[level] = { replies: texts.length, avgWords: avg(words), avgSentences: avg(t => sentences(t).length),
    avgLongestSentence: avg(t => Math.max(...sentences(t).map(words))), relativeClauses: texts.filter(t => /,\s*which\b/i.test(t)).length };
}
console.log(JSON.stringify({ calls, errors, summary, shape, outputs: outDir }, null, 2));
