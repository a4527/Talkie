// Browser-safe labels and score formatting for the mission screens (PRD 4.1, 4.5, DEC-080).
// Formatting works on the stored half-point integers; it never feeds back into the 80% decision.
import { GOAL_TOTAL_POINTS, LANGUAGE_AREA_POINTS, LANGUAGE_AREAS, type LanguageLevel, type MissionMode, type ScoreArea } from "./constants";

/** Talkie level guidance (MISSIONS "언어 수준별 설명"); a reference for choosing, not a certification. */
export const LEVEL_GUIDE: Record<LanguageLevel, { label: string; summary: string }> = {
  A1: { label: "A1", summary: "기본 단어·짧은 표현으로 원하는 것을 말해요. 상대가 천천히 말하고 반복해 주면 간단히 주고받을 수 있어요." },
  A2: { label: "A2", summary: "익숙한 일상 상황에서 단순한 정보를 주고받고 기본적인 요청·설명을 해요." },
  B1: { label: "B1", summary: "익숙한 상황을 연결된 문장으로 설명하고 간단한 이유를 붙여요. 예상과 다른 일에도 확인하며 대응해요." },
  B2: { label: "B2", summary: "비교적 복잡한 내용을 자세히 설명하고 대안의 장단점을 주고받으며 조건을 조율해요." },
  C: { label: "C (고급)", summary: "필요한 의미를 정확하고 자연스럽게 전달하고, 표현·말투·설명을 유연하게 조절해요." },
};

export const MODE_GUIDE: Record<MissionMode, { label: string; summary: string; resultLabel: string }> = {
  practice: { label: "연습", summary: "막히면 교정·힌트·다시 말하기를 받아요. 도움을 받아도 감점하지 않아요.", resultLabel: "도움을 포함한 연습 결과" },
  real: { label: "실전", summary: "교정·힌트 없이 직원과 대화해요. 대화가 계속 진전되지 않으면 실패로 마무리돼요.", resultLabel: "도움 없는 실전 결과" },
};

export const AREA_LABELS: Record<ScoreArea, string> = { goal: "미션 목표", grammar: "문법", vocabulary: "어휘와 표현", organization: "말의 구성", interaction: "상호작용" };
export const SCORE_AREAS: readonly ScoreArea[] = ["goal", ...LANGUAGE_AREAS];
export const AREA_FULL_POINTS: Record<ScoreArea, number> = { goal: GOAL_TOTAL_POINTS, grammar: LANGUAGE_AREA_POINTS, vocabulary: LANGUAGE_AREA_POINTS, organization: LANGUAGE_AREA_POINTS, interaction: LANGUAGE_AREA_POINTS };

export const VERDICT_LABELS = { met: "충족", partial: "부분 충족", unmet: "미충족", undeterminable: "판정 불가" } as const;

export function endReasonLabel(reason: string | null, routeLabel?: string) {
  switch (reason) {
    case "goal_completed": return routeLabel ? `미션 완료 · ${routeLabel}` : "미션 완료";
    case "no_progress_failed": return "실전 미션 실패 · 대화가 진전되지 않아 마무리";
    case "user_ended": return "직접 종료";
    case "resume_expired": return "24시간이 지나 자동 종료";
    default: return "결과 정리 중";
  }
}

/** Half-point integer as points, keeping .5 and dropping an unnecessary .0 (DEC-080). */
export function formatPoints(half: number) {
  return half % 2 === 0 ? String(half / 2) : `${(half - 1) / 2}.5`;
}

/** Rate to one decimal, rounding half up at the second decimal; null when nothing was evaluable. */
export function formatRate(earnedHalf: number, maxHalf: number) {
  if (maxHalf <= 0) return null;
  const tenths = Math.floor((earnedHalf * 2000 + maxHalf) / (2 * maxHalf));
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

/** Points excluded as undeterminable in an area: its full points minus the evaluated maximum. */
export function excludedPoints(area: ScoreArea, maxHalf: number) {
  return formatPoints(AREA_FULL_POINTS[area] * 2 - maxHalf);
}
