import { readNoteContext } from "./note-context";
import { formatKstDate } from "../learning/note";

/** Inclusive calendar-month window, using the database clock expressed in Korea. */
export function priorLearningWindow(now: Date) {
  const toDateKst = formatKstDate(now.toISOString());
  const [year, month, day] = toDateKst.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 7, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return { fromDateKst: first.toISOString().slice(0, 10), toDateKst };
}

/** Selected evidence from ended sessions, never pending state for the current session. */
export type PriorLearningContext = {
  reviewExpressions: { expression: string; lastPracticedDateKst?: string; observations?: string[] }[];
  topics?: { summary: string; observedDateKst: string }[];
  difficulty?: { summary: string; observedDateKst: string }[];
};

export const PRIOR_LEARNING_MAX_BYTES = 4096;

/** Read only the app's evidence-note format. Unknown/legacy formats contribute nothing. */
function selectLegacyContext(notes: readonly { learningEndDateKst: string; noteMarkdown: string }[]): PriorLearningContext {
  const expressions = new Map<string, { expression: string; lastPracticedDateKst: string }>();
  for (const note of notes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(note.learningEndDateKst) || !note.noteMarkdown.includes("비공개 음성 통합 시험 · 저장된 발화와 재생 완료된 AI 교정으로 구성했습니다.")) continue;
    const section = note.noteMarkdown.split("\n## 다음 복습\n")[1]?.split(/\n## /)[0];
    if (!section) continue;
    for (const block of section.trim().split(/\n\s*\n/)) {
      const lines = block.split("\n");
      if (!lines.every(line => line.startsWith("> "))) continue;
      const expression = lines.map(line => line.slice(2)).join("\n")
        .replace(/\\([\\`*_[\]{}()#!|])/g, "$1")
        .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
      if (!expression.trim() || new TextEncoder().encode(expression).length > 1200) continue;
      const previous = expressions.get(expression);
      if (!previous || previous.lastPracticedDateKst < note.learningEndDateKst) {
        expressions.set(expression, { expression, lastPracticedDateKst: note.learningEndDateKst });
      }
    }
  }
  // Inspect all eligible notes, deduplicate, then prefer expressions not seen recently.
  const reviewExpressions = [...expressions.values()].sort((a, b) =>
    a.lastPracticedDateKst.localeCompare(b.lastPracticedDateKst) || a.expression.localeCompare(b.expression));
  return { reviewExpressions };
}


type SavedNote = { learningEndDateKst: string; noteMarkdown: string };
/** The server applies access/lifetime/window filters before calling this function. */
export function selectPriorLearningContext(notes: readonly SavedNote[], difficultyNotes: readonly SavedNote[] = notes): PriorLearningContext {
  const result = selectLegacyContext(notes.filter(n => !n.noteMarkdown.includes("노트 형식:")));
  const reviews = new Map<string, { expression: string; lastPracticedDateKst?: string; observations?: string[]; sortDate: string }>(
    result.reviewExpressions.map(e => [e.expression, { expression: e.expression, observations: ["추천"], sortDate: e.lastPracticedDateKst ?? "" }]));
  const topics = new Map<string, { summary: string; observedDateKst: string }>();
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  for (const note of notes) {
    for (const item of readNoteContext(note.noteMarkdown)) {
      if (item.kind === "topic") {
        const previous = topics.get(item.summary);
        if (!previous || previous.observedDateKst < note.learningEndDateKst) topics.set(item.summary, { summary: item.summary, observedDateKst: note.learningEndDateKst });
      }
      if (item.kind !== "review" || new TextEncoder().encode(item.summary).length > 1200) continue;
      const old = reviews.get(item.summary);
      const date = [old?.lastPracticedDateKst, item.lastPracticedDateKst].filter((d): d is string => Boolean(d)).sort().at(-1);
      reviews.set(item.summary, { expression: item.summary, ...(date ? { lastPracticedDateKst: date } : {}),
        observations: [...new Set([...(old?.observations ?? []), ...(item.observations ?? [])])],
        sortDate: date ?? (old?.sortDate && old.sortDate > note.learningEndDateKst ? old.sortDate : note.learningEndDateKst) });
    }
  }
  result.reviewExpressions = [...reviews.values()].sort((a,b) => a.sortDate.localeCompare(b.sortDate) || a.expression.localeCompare(b.expression))
    .slice(0, 2).map(({ sortDate: _sortDate, ...item }) => item);
  const recentTopics = [...topics.values()].sort((a,b) => b.observedDateKst.localeCompare(a.observedDateKst) || a.summary.localeCompare(b.summary));
  const difficulties = difficultyNotes.map(note => ({ note, items: readNoteContext(note.noteMarkdown).filter(i => i.kind === "difficulty") }))
    .filter(n => n.items.length).sort((a,b) => b.note.learningEndDateKst.localeCompare(a.note.learningEndDateKst));
  const latest = difficulties[0]?.note.learningEndDateKst;
  const difficulty = difficulties.filter(n => n.note.learningEndDateKst === latest).flatMap(n => n.items.map(i => ({ summary: i.summary, observedDateKst: n.note.learningEndDateKst })));
  if (difficulty.length && size({ ...result, difficulty }) <= PRIOR_LEARNING_MAX_BYTES) result.difficulty = difficulty;
  for (const topic of recentTopics) {
    const next = [...(result.topics ?? []), topic];
    if (size({ ...result, topics: next }) <= PRIOR_LEARNING_MAX_BYTES) result.topics = next;
  }
  while (size(result) > PRIOR_LEARNING_MAX_BYTES && result.reviewExpressions.length) result.reviewExpressions.pop();
  return result;
}
