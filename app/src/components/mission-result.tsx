"use client";
import type { LearningRecordsResponse, MissionCriterionResult } from "../learning/types";
import { AREA_FULL_POINTS, AREA_LABELS, LEVEL_GUIDE, MODE_GUIDE, SCORE_AREAS, VERDICT_LABELS, endReasonLabel, excludedPoints, formatPoints, formatRate } from "../mission/display";
import { formatKoreanDate } from "../client/app";
import { GOAL_TOTAL_POINTS, LANGUAGE_TOTAL_POINTS, type LanguageLevel, type MissionMode, type ScoreArea } from "../mission/constants";

const FULL_HALF = (GOAL_TOTAL_POINTS + LANGUAGE_TOTAL_POINTS) * 2;

type Session = LearningRecordsResponse["sessions"][number];
type Catalog = LearningRecordsResponse["missions"];

export function missionTitle(session: Session, catalog: Catalog) {
  return catalog.find(m => m.missionId === session.mission?.missionId)?.title ?? "미션";
}
export function missionSummaryLabel(mission: NonNullable<Session["mission"]>) {
  return `${MODE_GUIDE[mission.missionMode as MissionMode]?.label ?? mission.missionMode} · ${LEVEL_GUIDE[mission.languageLevel as LanguageLevel]?.label ?? mission.languageLevel}`;
}

function Criterion({ item }: { item: MissionCriterionResult }) {
  return <li className={`criterion ${item.verdict}`}>
    <div className="criterion-head"><strong>{item.label}</strong><span className="criterion-points">{item.points}점</span><span className={`verdict ${item.verdict}`}>{VERDICT_LABELS[item.verdict]}</span></div>
    {item.reason && <p>{item.reason}</p>}
    {item.evidence.map((text, i) => <blockquote key={`e${i}`}>{text}</blockquote>)}
    {item.counterEvidence.length > 0 && <>
      <p className="small-label">함께 본 반대 근거</p>
      {item.counterEvidence.map((text, i) => <blockquote key={`c${i}`} className="counter">{text}</blockquote>)}
    </>}
  </li>;
}

/** Mission outcome and score, kept apart from each other and from the note (PRD 4.4, 4.5, DEC-080). */
export function MissionResult({ session, catalog }: { session: Session; catalog: Catalog }) {
  const mission = session.mission;
  if (!mission) return null;
  const entry = catalog.find(m => m.missionId === mission.missionId);
  const routeLabel = entry?.routes.find(r => r.routeId === mission.finalRouteId)?.label;
  const result = session.missionResult;
  const mode = MODE_GUIDE[mission.missionMode as MissionMode];
  const scored = result?.evaluationStatus === "ready" && result.areaScores && result.totalEarnedHalf !== null && result.totalMaxHalf !== null ? result : undefined;
  const rate = scored ? formatRate(scored.totalEarnedHalf!, scored.totalMaxHalf!) : null;
  return <section className="card mission-result" aria-label="미션 결과">
    <span className="eyebrow">MISSION RESULT</span>
    <h2>{entry?.title ?? "미션"}</h2>
    <p className="mission-meta">{missionSummaryLabel(mission)}</p>
    <p className={`mission-outcome ${mission.missionEndReason ?? "pending"}`}>{endReasonLabel(mission.missionEndReason, routeLabel)}</p>

    {!result || result.evaluationStatus === "pending" ? <div className="note-waiting" role="status"><span className="pulse" aria-hidden="true" /><p>대화를 돌아보며 점수를 매기고 있어요…</p></div>
      : result.evaluationStatus === "skipped" ? <p>저장된 발화가 없어 평가하지 않았어요.</p>
      : result.evaluationStatus === "unavailable" ? <p>기한 안에 평가를 마치지 못해 이 미션의 점수는 표시하지 않고 달성 일수에도 포함하지 않아요.</p>
      : scored && <>
        <div className="score-summary">
          <div><span className="small-label">{mode?.resultLabel ?? "결과"}</span>
            <p className="score-total"><strong>{formatPoints(scored.totalEarnedHalf!)}</strong> / {formatPoints(scored.totalMaxHalf!)}점</p></div>
          {rate ? <div className="score-rate"><strong>{rate}</strong>
            <span className={`pill ${scored.meetsThreshold ? "met" : "unmet"}`}>{scored.meetsThreshold ? "달성 기준 80% 이상" : "달성 기준 80% 미만"}</span></div>
            : <p className="hint">평가할 수 있는 근거가 없어 달성률을 계산하지 않았어요.</p>}
        </div>
        <AchievementDay session={session} />
        {scored.totalMaxHalf! < FULL_HALF && <p className="hint">판정 불가 항목 {formatPoints(FULL_HALF - scored.totalMaxHalf!)}점을 제외한 {formatPoints(scored.totalMaxHalf!)}점 만점으로 계산했어요.</p>}
        <table className="area-table">
          <thead><tr><th scope="col">영역</th><th scope="col">획득 / 평가 만점</th><th scope="col">판정 불가 제외</th></tr></thead>
          <tbody>{SCORE_AREAS.map(area => {
            const value = scored.areaScores![area];
            return <tr key={area}><th scope="row">{AREA_LABELS[area]}</th><td>{formatPoints(value.earnedHalf)} / {formatPoints(value.maxHalf)}</td><td>{value.maxHalf < 2 * AREA_FULL_POINTS[area] ? `${excludedPoints(area, value.maxHalf)}점` : "—"}</td></tr>;
          })}</tbody>
        </table>
        {scored.criteria ? <div className="criteria">
          {SCORE_AREAS.map(area => {
            const items = scored.criteria!.filter(c => c.area === (area as ScoreArea));
            return items.length ? <details key={area} open={area === "goal"}>
              <summary>{AREA_LABELS[area]} 항목별 근거</summary>
              <ul>{items.map(item => <Criterion key={item.criterionId} item={item} />)}</ul>
            </details> : null;
          })}
        </div> : <p className="hint">항목별 판정과 근거는 보관 기간이 지나 삭제됐어요. 점수 요약만 남아 있어요.</p>}
      </>}
    <p className="hint">AI가 실제로 저장된 대화를 근거로 판정한 이번 미션의 점수예요. 공인 수준 인증이 아니에요.</p>
  </section>;
}

/** Whether this mission credited an achievement day (PRD 4.5, DEC-095). The date is stored, never derived on screen. */
function AchievementDay({ session }: { session: Session }) {
  const result = session.missionResult;
  if (result?.achievementDate) return <p className="notice-line">{formatKoreanDate(result.achievementDate)} 달성 일수로 인정됐어요. 같은 날 여러 미션을 달성해도 하루로 세요.</p>;
  if (result?.meetsThreshold && session.mission?.missionEndReason === "resume_expired") return <p className="hint">재개 기한이 지나 자동으로 끝난 미션이라 달성 일수에는 포함하지 않아요.</p>;
  return null;
}
