import type { ConversationSnapshot } from "../learning/types";

export const NOTE_FORMAT = "노트 형식: talkie-learning-note-v1";
export type NoteContextItem = {
  kind: "topic" | "difficulty" | "review";
  summary: string;
  // Verbatim evidence copied into the note, never a reference to deleted source alone.
  evidence: { turnId: string; role: "user" | "assistant"; text: string }[];
  explanation?: string;
  observations?: string[];
  lastPracticedDateKst?: string;
};
const observations = ["추천", "질문", "도움 필요", "재시도 성공", "재시도 실패", "자발적 사용"];
export function noteLiteral(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]{}()#!|]/g, "\\$&").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;");
}
function readLiteral(value: string) {
  return value.replace(/\\([\\`*_[\]{}()#!|])/g, "$1").replace(/&#10;/g, "\n").replace(/&#13;/g, "\r")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}
export function validNoteDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
/** The caller supplies only confirmed, played turns. This verifies existence, not AI judgement. */
export function validateContextItems(items: readonly NoteContextItem[], snapshot: ConversationSnapshot) {
  return items.filter(item => ["topic", "difficulty", "review"].includes(item.kind) && item.summary.trim() &&
    item.evidence.length > 0 && item.evidence.every(e => e.text.trim() && snapshot.turns.some(t =>
      t.turnId === e.turnId && t.role === e.role && t.text.includes(e.text))) &&
    (!item.observations || item.observations.every(o => observations.includes(o))) &&
    (!item.lastPracticedDateKst || (validNoteDate(item.lastPracticedDateKst) && item.kind === "review" &&
      item.observations?.some(o => ["재시도 성공", "재시도 실패", "자발적 사용"].includes(o)) && item.evidence.some(e => e.role === "user"))));
}
const headings = { topic: "주제", difficulty: "난이도", review: "복습 표현" } as const;
export function renderNoteContext(items: readonly NoteContextItem[]) {
  return ["## 학습 맥락", ...(["topic", "difficulty", "review"] as const).flatMap(kind => [
    `### ${headings[kind]}`, ...(items.some(i => i.kind === kind) ? items.flatMap((item, index) => item.kind !== kind ? [] : [
      `#### ${kind}-${index + 1}`, `내용: ${noteLiteral(item.summary)}`,
      `관찰: ${(item.observations ?? []).join(" · ") || "미확인"}`,
      `확인된 연습일: ${item.lastPracticedDateKst ?? "미확인"}`, `[근거](#detail-${index + 1})`,
    ]) : ["확인된 정보 없음"]),
  ])].join("\n\n");
}
export function renderContextDetails(items: readonly NoteContextItem[]) {
  return items.map((item, index) => [`### 근거 detail-${index + 1}`, `<a id="detail-${index + 1}"></a>`,
    ...(item.explanation ? [`설명: ${noteLiteral(item.explanation)}`] : []),
    ...item.evidence.map(e => `발화: ${noteLiteral(e.turnId)} / ${e.role}\n\n> ${noteLiteral(e.text)}`),
  ].join("\n\n")).join("\n\n");
}
/** Read our canonical visible Markdown only. Never fall back to a legacy parser for marked notes. */
export function readNoteContext(markdown: string): NoteContextItem[] {
  const lines = markdown.split("\n");
  if (!/^# [^\n]+\n\n노트 형식: talkie-learning-note-v1\n/.test(markdown) ||
    lines.filter(l => l === "## 학습 맥락").length !== 1 || lines.filter(l => l === "## 학습 상세").length !== 1) return [];
  const top = markdown.split("\n## 학습 맥락\n")[1]?.split("\n## 학습 상세\n")[0];
  if (!top || Object.values(headings).some(h => top.split(`\n### ${h}\n`).length !== 2)) return [];
  const details = markdown.split("\n## 학습 상세\n")[1];
  const result: NoteContextItem[] = [];
  for (const kind of ["topic", "difficulty", "review"] as const) {
    const section = top.split(`\n### ${headings[kind]}\n`)[1]?.split(/\n### /)[0] ?? "";
    for (const block of section.split(/\n(?=#### )/)) {
      const match = block.trim().match(new RegExp(`^#### ${kind}-(\\d+)\\n\\n내용: ([^\\n]+)\\n\\n관찰: ([^\\n]+)\\n\\n확인된 연습일: ([^\\n]+)\\n\\n\\[근거\\]\\(#detail-(\\d+)\\)$`));
      if (!match || match[1] !== match[5]) continue;
      const id = match[1];
      const anchor = `<a id="detail-${id}"></a>`;
      if (lines.filter(l => l === anchor).length !== 1 || lines.filter(l => l === `#### ${kind}-${id}`).length !== 1) continue;
      const detail = details.split(`### 근거 detail-${id}\n\n${anchor}\n\n`);
      if (detail.length !== 2) continue;
      const body = detail[1].split(/\n### /)[0];
      const evidence = [...body.matchAll(/(?:^|\n\n)발화: ([^\n]+) \/ (user|assistant)\n\n> ([^\n]+)/g)]
        .map(m => ({ turnId: readLiteral(m[1]), role: m[2] as "user" | "assistant", text: readLiteral(m[3]) }));
      const obs = match[3] === "미확인" ? [] : match[3].split(" · ");
      if (!evidence.length || obs.some(o => !observations.includes(o))) continue;
      const date = match[4] === "미확인" ? undefined : match[4];
      if (date && (!validNoteDate(date) || kind !== "review" || !obs.some(o => ["재시도 성공", "재시도 실패", "자발적 사용"].includes(o)))) continue;
      result.push({ kind, summary: readLiteral(match[2]), observations: obs, evidence, ...(date ? { lastPracticedDateKst: date } : {}) });
    }
  }
  return result;
}
