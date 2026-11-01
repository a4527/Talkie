import { formatKstDate } from "../learning/note";
import type { ConversationSnapshot } from "../learning/types";
import type { NoteDetailItem } from "./note-extraction";
import { NOTE_FORMAT, noteLiteral, renderContextDetails, renderNoteContext, validateContextItems, type NoteContextItem } from "./note-context";

const DETAIL_LABEL: Record<NoteDetailItem["kind"], string> = { summary: "대화 요약", praise: "잘한 점", question_expression: "직접 질문한 표현",
  correction: "교정", key_expression: "핵심 표현", example: "복습용 응용", next_review: "다음 복습" };
/** Detail sections use their own `extra-N` anchors so the context reader's `detail-N` links stay untouched. */
function renderExtractionDetails(items: readonly NoteDetailItem[]) {
  return items.map((item, index) => [`### 세부 ${index + 1}: ${DETAIL_LABEL[item.kind]}`, `<a id="extra-${index + 1}"></a>`,
    `${item.adapted ? "복습용 응용(실제 발화 아님): " : ""}${noteLiteral(item.text)}`,
    ...item.evidence.map(e => `발화: ${noteLiteral(e.turnId)} / ${e.role}\n\n> ${noteLiteral(e.text)}`),
  ].join("\n\n")).join("\n\n");
}

export type VoiceNoteExtraction = { details: readonly NoteDetailItem[]; incomplete: boolean };

/** No provider call here. Optional extraction results are validated again before rendering. */
export function buildVoiceNoteMarkdown(snapshot: ConversationSnapshot, endedAt: string, candidates: readonly NoteContextItem[] = [], extraction?: VoiceNoteExtraction) {
  const user = snapshot.turns.filter(t => t.role === "user");
  if (!user.length) return null;
  const corrections: NoteContextItem[] = snapshot.corrections.flatMap(c => {
    const source = user.find(t => t.turnId === c.sourceTurnId);
    const delivered = snapshot.turns.find(t => t.turnId === c.deliveredTurnId && t.role === "assistant" && t.text.includes(c.replacement));
    if (!source || !delivered || !c.replacement.trim()) return [];
    const attempts = c.attempts.filter(a => user.some(t => t.turnId === a.turnId));
    return [{ kind: "review" as const, summary: c.replacement, explanation: [c.explanation, ...attempts.map(a => `재시도 ${a.turnId}: AI 판정 ${a.outcome === "success" ? "성공" : "실패"} (숙달 판정 아님)`)].filter(Boolean).join("\n"),
      observations: [...new Set(["추천", ...attempts.map(a => a.outcome === "success" ? "재시도 성공" : "재시도 실패")])],
      evidence: [{ turnId: source.turnId, role: source.role, text: source.text },
        { turnId: delivered.turnId, role: delivered.role, text: c.replacement },
        ...attempts.map(a => { const turn = user.find(t => t.turnId === a.turnId)!; return { turnId: turn.turnId, role: turn.role, text: turn.text }; })],
      // Existing snapshots have no per-turn timestamp. Do not invent a practice date from the note date.
    }];
  }).slice(-3);
  const proposed = [...candidates, ...corrections];
  const items = validateContextItems(proposed, snapshot);
  const missing = snapshot.hasConversationGaps || items.length !== proposed.length || extraction?.incomplete === true;
  const details = extraction?.details ?? [];
  return [`# ${formatKstDate(endedAt)} 영어 학습 노트`, NOTE_FORMAT,
    extraction ? "비공개 음성 통합 시험 · AI가 저장된 대화에서 선별한 내용이며 근거 인용만 앱이 검증했습니다. 언어 평가의 정확성은 보장하지 않습니다."
      : "비공개 음성 통합 시험 · 저장된 발화와 재생 완료된 AI 교정으로 구성했습니다. 전체 대화의 AI 선별·요약은 아직 연결하지 않았습니다.",
    ...(missing ? ["일부 학습 내용 또는 대화 기록이 누락됐습니다."] : []),
    renderNoteContext(items), "## 학습 상세", renderContextDetails(items),
    ...(details.length ? [renderExtractionDetails(details)] : []),
    "### 대화 근거 일부", ...user.slice(-3).map(t => `발화: ${noteLiteral(t.turnId)} / user\n\n> ${noteLiteral(t.text.slice(0, 160))}`),
    ...(items.length || details.length ? [] : ["저장된 근거에 연결된 학습 항목이 없습니다."]),
  ].join("\n\n") + "\n";
}
