import { formatKstDate } from "../learning/note";
import type { ConversationSnapshot } from "../learning/types";
import { NOTE_FORMAT, noteLiteral, renderContextDetails, renderNoteContext, validateContextItems, type NoteContextItem } from "./note-context";

/** No extra provider call. Optional extraction candidates are validated before rendering. */
export function buildVoiceNoteMarkdown(snapshot: ConversationSnapshot, endedAt: string, candidates: readonly NoteContextItem[] = []) {
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
  const missing = snapshot.hasConversationGaps || items.length !== proposed.length;
  return [`# ${formatKstDate(endedAt)} 영어 학습 노트`, NOTE_FORMAT,
    "비공개 음성 통합 시험 · 저장된 발화와 재생 완료된 AI 교정으로 구성했습니다. 전체 대화의 AI 선별·요약은 아직 연결하지 않았습니다.",
    ...(missing ? ["일부 학습 내용 또는 대화 기록이 누락됐습니다."] : []),
    renderNoteContext(items), "## 학습 상세", renderContextDetails(items),
    "### 대화 근거 일부", ...user.slice(-3).map(t => `발화: ${noteLiteral(t.turnId)} / user\n\n> ${noteLiteral(t.text.slice(0, 160))}`),
    ...(items.length ? [] : ["저장된 근거에 연결된 학습 항목이 없습니다."]),
  ].join("\n\n") + "\n";
}
