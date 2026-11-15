// Fixed mission definitions and rubrics (DEC-086). Versions are append-only: add a new
// object for any change and keep old versions so stored sessions and results stay readable.
// Partner knowledge and rubric details are for the server and evaluation prompts only;
// browsers receive `toPublicMission` output.

import type { MissionCatalogEntry, MissionCriterionResult } from "../learning/types";
import { GOAL_TOTAL_POINTS, LANGUAGE_AREA_POINTS, LANGUAGE_AREAS, LANGUAGE_LEVELS, MISSION_MODES, type LanguageArea, type LanguageLevel, type MissionMode } from "./constants";
export { GOAL_TOTAL_POINTS, LANGUAGE_AREA_POINTS, LANGUAGE_AREAS, LANGUAGE_LEVELS, LANGUAGE_TOTAL_POINTS, MISSION_MODES, type LanguageArea, type LanguageLevel, type MissionMode } from "./constants";

export interface MissionRoute { routeId: string; label: string; fixedConditions: string; completion: string }
export interface MissionDefinition {
  missionId: string;
  definitionVersion: number;
  /** Shown to the learner before and during the mission. */
  publicView: { title: string; situation: string; learnerRole: string; partnerRole: string; goals: readonly string[] };
  /** Role knowledge boundary for the partner (DEC-076). Never sent to the browser. */
  partner: { knowsAtStart: readonly string[]; learnsOnlyFromLearner: readonly string[]; rules: readonly string[] };
  routes: readonly MissionRoute[];
}
export interface GoalCriterion { criterionId: string; label: string; points: number; evidence: string }
export interface LanguageCriterion { criterionId: string; area: LanguageArea; label: string; points: number }
export interface MissionRubric {
  missionId: string;
  rubricVersion: number;
  goalCriteria: readonly GoalCriterion[];
  languageCriteria: readonly LanguageCriterion[];
}
export interface MissionStartRequest { missionId: string; missionMode: MissionMode; languageLevel: LanguageLevel }
export interface PublicMission extends MissionStartRequest {
  definitionVersion: number;
  rubricVersion: number;
  title: string; situation: string; learnerRole: string; partnerRole: string; goals: readonly string[];
  /** Route IDs only (not partner knowledge), so the browser can drop reports naming unknown routes. */
  routeIds: readonly string[];
}


// Shared by every mission (PRD 4.5.2, DEC-079). Each area has one 4-point and two 3-point criteria.
const LANGUAGE_CRITERIA_V1: readonly LanguageCriterion[] = [
  { criterionId: "grammar_meaning_relations", area: "grammar", label: "의미 관계의 정확성", points: 4 },
  { criterionId: "grammar_sentence_structure", area: "grammar", label: "문장 구조", points: 3 },
  { criterionId: "grammar_level_stability", area: "grammar", label: "선택 수준에서의 안정성", points: 3 },
  { criterionId: "vocabulary_intended_words", area: "vocabulary", label: "의도에 맞는 단어", points: 4 },
  { criterionId: "vocabulary_natural_combinations", area: "vocabulary", label: "자연스러운 단어 조합", points: 3 },
  { criterionId: "vocabulary_situational_expressions", area: "vocabulary", label: "상황에 적절한 표현", points: 3 },
  { criterionId: "organization_information_order", area: "organization", label: "정보 제시 순서", points: 4 },
  { criterionId: "organization_reason_contrast_condition", area: "organization", label: "이유·대조·조건 연결", points: 3 },
  { criterionId: "organization_concise_relevant", area: "organization", label: "간결성과 관련성", points: 3 },
  { criterionId: "interaction_responsive_reply", area: "interaction", label: "상대 말에 맞는 응답", points: 4 },
  { criterionId: "interaction_explain_confirm_repair", area: "interaction", label: "필요한 설명·확인·수정", points: 3 },
  { criterionId: "interaction_connection_to_prior", area: "interaction", label: "앞선 대화와의 연결", points: 3 },
];

// PRD 4.2.1 (DEC-081) and 4.5.1 (DEC-071).
const CAFE_WRONG_ORDER_V1: MissionDefinition = {
  missionId: "cafe-wrong-order",
  definitionVersion: 1,
  publicView: {
    title: "잘못 나온 카페 주문 해결",
    situation: "카페에서 따뜻한 디카페인 라테를 주문했는데 차가운 일반 라테가 나왔습니다. 카운터의 직원에게 문제를 알리고 원하는 처리를 합의하세요.",
    learnerRole: "음료를 받은 손님",
    partnerRole: "카페 카운터 직원",
    goals: ["주문과 다른 점을 직원에게 알리기", "원하는 처리를 요청하기", "직원과 최종 처리에 합의하기"],
  },
  partner: {
    knowsAtStart: [
      "A different staff member took the customer's order.",
      "The customer has come back to the counter holding a drink from this cafe.",
      "The cup label can be checked only after the customer mentions a problem with the drink.",
    ],
    learnsOnlyFromLearner: [
      "What the customer originally ordered (hot, decaf latte).",
      "What is wrong with the drink they received (iced, regular caffeine).",
      "Which resolution the customer wants.",
    ],
    rules: [
      "Greet so the customer can explain; do not guess the order, the mismatch or the resolution in advance.",
      "Reuse information the customer already gave; ask only about missing or unclear conditions.",
      "If the customer asks how it can be fixed, offer both allowed resolutions.",
      "Do not invent receipts, fees, approvals, stock shortages or other obstacles that are not defined here.",
      "Finish only after the customer accepts a concrete allowed resolution and you confirm it; do not prolong the conversation after that.",
      "All payments and refunds are fictional.",
    ],
  },
  routes: [
    { routeId: "remake", label: "재제조", fixedConditions: "No extra charge. Remake as a hot decaf latte. About 5 minutes wait.",
      completion: "The customer agrees to the drink and the wait, and the staff member confirms the remake." },
    { routeId: "refund", label: "환불", fixedConditions: "Cancel this drink and give a full refund. No new payment and no fee.",
      completion: "The customer agrees to the cancellation and refund, and the staff member confirms the refund." },
  ],
};

const CAFE_WRONG_ORDER_RUBRIC_V1: MissionRubric = {
  missionId: "cafe-wrong-order",
  rubricVersion: 1,
  goalCriteria: [
    { criterionId: "temperature_mismatch", label: "온도가 주문과 다름을 전달", points: 5, evidence: "The learner made clear they wanted a hot drink but received an iced one." },
    { criterionId: "caffeine_mismatch", label: "카페인 조건이 주문과 다름을 전달", points: 5, evidence: "The learner made clear they ordered decaf but received regular caffeine." },
    { criterionId: "resolution_request", label: "원하는 처리 요청", points: 10, evidence: "The learner requested an allowed resolution (remake or refund)." },
    { criterionId: "final_temperature_resolved", label: "최종 처리의 온도 조건 해결", points: 10, evidence: "The final resolution meets the temperature condition or an allowed alternative, confirmed with the learner. A confirmed refund counts." },
    { criterionId: "final_caffeine_resolved", label: "최종 처리의 카페인 조건 해결", points: 10, evidence: "The final resolution meets the decaf condition or an allowed alternative, confirmed with the learner. A confirmed refund counts." },
    { criterionId: "final_agreement", label: "최종 처리에 합의", points: 20, evidence: "The learner accepted a concrete allowed resolution and the staff member confirmed it. A proposal alone does not count." },
  ],
  languageCriteria: LANGUAGE_CRITERIA_V1,
};

const DEFINITIONS: readonly MissionDefinition[] = [CAFE_WRONG_ORDER_V1];
const RUBRICS: readonly MissionRubric[] = [CAFE_WRONG_ORDER_RUBRIC_V1];

/** Returns problems with a definition/rubric pair; an empty list means it can be fixed at start. */
export function validateMission(definition: MissionDefinition, rubric: MissionRubric): string[] {
  const problems: string[] = [];
  const unique = (ids: string[], what: string) => { if (new Set(ids).size !== ids.length) problems.push(`duplicate ${what}`); };
  if (definition.missionId !== rubric.missionId) problems.push("mission id mismatch");
  if (!Number.isInteger(definition.definitionVersion) || definition.definitionVersion < 1) problems.push("invalid definition version");
  if (!Number.isInteger(rubric.rubricVersion) || rubric.rubricVersion < 1) problems.push("invalid rubric version");
  if (!definition.routes.length) problems.push("no routes");
  unique(definition.routes.map(r => r.routeId), "route id");
  const all = [...rubric.goalCriteria, ...rubric.languageCriteria];
  unique(all.map(c => c.criterionId), "criterion id");
  if (all.some(c => !Number.isInteger(c.points) || c.points <= 0)) problems.push("criterion points must be positive integers");
  if (rubric.goalCriteria.reduce((sum, c) => sum + c.points, 0) !== GOAL_TOTAL_POINTS) problems.push(`goal points must total ${GOAL_TOTAL_POINTS}`);
  for (const area of LANGUAGE_AREAS) {
    const criteria = rubric.languageCriteria.filter(c => c.area === area);
    if (criteria.length !== 3 || criteria.reduce((sum, c) => sum + c.points, 0) !== LANGUAGE_AREA_POINTS) problems.push(`${area} must have 3 criteria totalling ${LANGUAGE_AREA_POINTS}`);
  }
  if (rubric.languageCriteria.length !== LANGUAGE_AREAS.length * 3) problems.push("unknown language area");
  return problems;
}

export function findMissionDefinition(missionId: string, definitionVersion: number) {
  return DEFINITIONS.find(d => d.missionId === missionId && d.definitionVersion === definitionVersion);
}
export function findMissionRubric(missionId: string, rubricVersion: number) {
  return RUBRICS.find(r => r.missionId === missionId && r.rubricVersion === rubricVersion);
}

/** Latest valid definition and rubric for a new start; undefined if the mission is unknown or invalid. */
export function currentMission(missionId: string) {
  const latest = <T>(items: readonly T[], version: (item: T) => number) => items.reduce<T | undefined>((best, item) => !best || version(item) > version(best) ? item : best, undefined);
  const definition = latest(DEFINITIONS.filter(d => d.missionId === missionId), d => d.definitionVersion);
  const rubric = latest(RUBRICS.filter(r => r.missionId === missionId), r => r.rubricVersion);
  if (!definition || !rubric || validateMission(definition, rubric).length) return undefined;
  return { definition, rubric };
}

export function listStartableMissions() {
  return [...new Set(DEFINITIONS.map(d => d.missionId))].flatMap(id => currentMission(id) ? [id] : []);
}

/** Strict parser for the start request; returns undefined for anything else. */
export function parseMissionStartRequest(input: unknown): MissionStartRequest | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["missionId", "missionMode", "languageLevel"].includes(key))) return;
  if (typeof value.missionId !== "string" || !/^[a-z0-9-]{1,64}$/.test(value.missionId)) return;
  if (!MISSION_MODES.includes(value.missionMode as MissionMode) || !LANGUAGE_LEVELS.includes(value.languageLevel as LanguageLevel)) return;
  return { missionId: value.missionId, missionMode: value.missionMode as MissionMode, languageLevel: value.languageLevel as LanguageLevel };
}

/** Browser-safe view: no partner knowledge, route conditions or rubric. */
export function toPublicMission(definition: MissionDefinition, rubricVersion: number, fixed: Omit<MissionStartRequest, "missionId">): PublicMission {
  return { missionId: definition.missionId, definitionVersion: definition.definitionVersion, rubricVersion,
    missionMode: fixed.missionMode, languageLevel: fixed.languageLevel, ...definition.publicView, goals: [...definition.publicView.goals],
    routeIds: definition.routes.map(r => r.routeId) };
}

/** Pre-start view of each startable mission: public situation, roles, goals and route labels only. */
export function listMissionCatalog(): MissionCatalogEntry[] {
  return listStartableMissions().flatMap(id => {
    const mission = currentMission(id);
    return mission ? [{ missionId: id, ...mission.definition.publicView, goals: [...mission.definition.publicView.goals],
      routes: mission.definition.routes.map(r => ({ routeId: r.routeId, label: r.label })) }] : [];
  });
}

/** Attaches fixed labels/points to stored judgements, in rubric order; unknown IDs are dropped. */
export function describeJudgements(missionId: string, rubricVersion: number, judgements: readonly StoredJudgement[]): MissionCriterionResult[] {
  const rubric = findMissionRubric(missionId, rubricVersion);
  if (!rubric) return [];
  const byId = new Map(judgements.map(j => [j.criterionId, j]));
  const criteria = [...rubric.goalCriteria.map(c => ({ ...c, area: "goal" as const })), ...rubric.languageCriteria];
  return criteria.flatMap(c => {
    const j = byId.get(c.criterionId);
    return j ? [{ criterionId: c.criterionId, area: c.area, label: c.label, points: c.points, verdict: j.verdict, reason: j.reason,
      evidence: j.evidence.map(e => e.text), counterEvidence: j.counterEvidence.map(e => e.text) }] : [];
  });
}
type StoredJudgement = { criterionId: string; verdict: MissionCriterionResult["verdict"]; reason: string; evidence: { text: string }[]; counterEvidence: { text: string }[] };

