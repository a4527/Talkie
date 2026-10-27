import type { Note, NoteRequest } from "./types";

export function formatKstDate(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

export function buildNote(request: NoteRequest): Note {
  const evidence = request.turns.filter(t => t.role === "user").map(t => ({ turnId: t.turnId, text: t.text }));
  return {
    learningEndDateKst: formatKstDate(request.endedAt), evidence,
    items: request.corrections.map(c => ({
      sourceTurnId: c.sourceTurnId,
      original: evidence.find(t => t.turnId === c.sourceTurnId)?.text ?? "",
      deliveredTurnId: c.deliveredTurnId,
      replacement: c.replacement, explanation: c.explanation, attempts: c.attempts,
    })),
  };
}

export function validateNote(note: Note, request: NoteRequest): boolean {
  if (note.learningEndDateKst !== formatKstDate(request.endedAt) || note.evidence.length === 0) return false;
  const userTurns = request.turns.filter(t => t.role === "user");
  if (note.evidence.length !== userTurns.length || new Set(note.evidence.map(e => e.turnId)).size !== userTurns.length) return false;
  if (!note.evidence.every(e => userTurns.some(t => t.turnId === e.turnId && t.text === e.text))) return false;
  if (note.items.length !== request.corrections.length || new Set(note.items.map(i => i.sourceTurnId)).size !== note.items.length) return false;
  return note.items.every(i => request.corrections.some(c =>
    c.sourceTurnId === i.sourceTurnId && c.deliveredTurnId === i.deliveredTurnId &&
    c.replacement === i.replacement && c.explanation === i.explanation &&
    userTurns.some(t => t.turnId === i.sourceTurnId && t.text === i.original) &&
    request.turns.some(t => t.turnId === i.deliveredTurnId && t.role === "assistant" && t.text.includes(i.replacement)) &&
    JSON.stringify(c.attempts) === JSON.stringify(i.attempts) &&
    i.attempts.every(a => userTurns.some(t => t.turnId === a.turnId))));
}

// User text stays literal text in both the UI and Markdown; never render it as HTML.
function quote(text: string): string {
  const literal = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#!|]/g, "\\$&");
  return literal.split(/\r?\n/).map(line => `> ${line}`).join("\n");
}

export function renderNoteMarkdown(note: Note): string {
  return [
    `# ${note.learningEndDateKst} 영어 학습 노트`,
    "가짜 AI · 로컬 텍스트 데모 / 실제 언어 평가 결과가 아닙니다.",
    "## 대화 요약", "일상 대화 데모에서 확인된 내 답변입니다.",
    ...note.evidence.map(e => `${quote(e.text)}\n\n근거: ${e.turnId}`),
    "## 잘한 점", `답변 ${note.evidence.length}개를 대화 기록에 남겼습니다. 언어 정확도는 평가하지 않았습니다.`,
    "## 주요 교정",
    ...(note.items.length ? note.items.map(i => [
      `원문 (${i.sourceTurnId})`, quote(i.original), `데모 표현 (${i.deliveredTurnId})`,
      quote(i.replacement), i.explanation,
      i.attempts.length ? i.attempts.map(a => `- 재시도 ${a.turnId}: ${a.outcome === "success" ? "시나리오 성공" : "시나리오 실패"}`).join("\n") : "재시도 기록 없음",
    ].join("\n\n")) : ["확인된 교정이 없습니다."]),
    "## 핵심 표현 · 다음 복습",
    ...(note.items.length ? note.items.map(i => quote(i.replacement)) : ["확인된 학습 표현이 없습니다."]),
  ].join("\n\n") + "\n";
}
