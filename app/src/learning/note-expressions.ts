import { NOTE_FORMAT, readLiteral, readNoteContext } from "../voice/note-context";

/**
 * F-12 expression browsing (B-08). Reads only the app's own visible note Markdown; the stored note stays the
 * single source, so deleted/expired notes disappear from the index with the note itself.
 * Generated practice sentences (`example`, adapted) and summary/praise lines are not expressions the learner met.
 */
export type ExpressionKind = "review" | "question_expression" | "correction" | "key_expression" | "next_review";
export const EXPRESSION_KIND_LABEL: Record<ExpressionKind, string> = {
  review: "복습 표현", question_expression: "직접 질문한 표현", correction: "교정", key_expression: "핵심 표현", next_review: "다음 복습",
};
const DETAIL_KIND_BY_LABEL: Record<string, ExpressionKind> = {
  "직접 질문한 표현": "question_expression", "교정": "correction", "핵심 표현": "key_expression", "다음 복습": "next_review",
};
const MAX_EXPRESSION_CHARS = 300;

export type NoteExpression = { text: string; kind: ExpressionKind };

function quotedBlocks(section: string) {
  return section.trim().split(/\n\s*\n/).flatMap(block => {
    const lines = block.split("\n");
    return lines.every(line => line.startsWith("> ")) ? [readLiteral(lines.map(line => line.slice(2)).join("\n"))] : [];
  });
}

/** Expressions shown in one note, in note order, without duplicates of the same kind and text. */
export function extractNoteExpressions(markdown: string): NoteExpression[] {
  const found: NoteExpression[] = [];
  if (markdown.includes(`\n\n${NOTE_FORMAT}\n`)) {
    for (const item of readNoteContext(markdown)) if (item.kind === "review") found.push({ text: item.summary, kind: "review" });
    const details = markdown.split("\n## 학습 상세\n")[1] ?? "";
    for (const match of details.matchAll(/(?:^|\n)### 세부 (\d+): ([^\n]+)\n\n<a id="extra-(\d+)"><\/a>\n\n([^\n]+)/g)) {
      const kind = DETAIL_KIND_BY_LABEL[match[2]];
      if (!kind || match[1] !== match[3] || match[4].startsWith("복습용 응용")) continue;
      found.push({ text: readLiteral(match[4]), kind });
    }
  } else {
    // Older demo/voice notes only list review expressions as quotes under one heading.
    const section = markdown.split(/\n## (?:다음 복습|핵심 표현 · 다음 복습)\n/)[1]?.split(/\n## /)[0];
    if (section) for (const text of quotedBlocks(section)) found.push({ text, kind: "review" });
  }
  const seen = new Set<string>();
  return found.map(e => ({ ...e, text: e.text.trim() })).filter(e => {
    const key = `${e.kind}|${normalizeExpression(e.text)}`;
    if (!e.text || e.text.length > MAX_EXPRESSION_CHARS || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeExpression(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?。]+$/, "");
}

export type ExpressionEntry = {
  text: string;
  kinds: ExpressionKind[];
  /** Distinct Korea end dates, newest first; each links to that day's notes. */
  dates: string[];
};
type IndexedNote = { learningEndDateKst: string; noteMarkdown: string };

/** One row per expression across notes; newest appearance first. */
export function buildExpressionIndex(notes: readonly IndexedNote[]): ExpressionEntry[] {
  const index = new Map<string, ExpressionEntry>();
  const ordered = [...notes].sort((a, b) => b.learningEndDateKst.localeCompare(a.learningEndDateKst));
  for (const note of ordered) {
    for (const expression of extractNoteExpressions(note.noteMarkdown)) {
      const key = normalizeExpression(expression.text);
      const entry = index.get(key) ?? { text: expression.text, kinds: [], dates: [] };
      if (!entry.kinds.includes(expression.kind)) entry.kinds.push(expression.kind);
      if (!entry.dates.includes(note.learningEndDateKst)) entry.dates.push(note.learningEndDateKst);
      index.set(key, entry);
    }
  }
  return [...index.values()].sort((a, b) => b.dates[0].localeCompare(a.dates[0]) || a.text.localeCompare(b.text));
}

export function filterExpressions(entries: readonly ExpressionEntry[], query: string) {
  const q = normalizeExpression(query);
  return q ? entries.filter(e => normalizeExpression(e.text).includes(q)) : [...entries];
}

/** Matches a day by its date (e.g. "11-02", "2026-11") or by the visible note text. */
export function noteDayMatches(dateKst: string, notes: readonly IndexedNote[], query: string) {
  const q = normalizeExpression(query);
  if (!q) return true;
  return dateKst.includes(q) || notes.some(n => normalizeExpression(visibleNoteText(n.noteMarkdown)).includes(q));
}

/** Drops anchors, format markers and stored turn IDs, which the note screen does not show as text. */
function visibleNoteText(markdown: string) {
  return readLiteral(markdown.split("\n").filter(line => !/^(<a id=|노트 형식:|발화: |근거: )/.test(line)).join("\n"));
}
