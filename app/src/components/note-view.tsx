import { Fragment, type ReactNode } from "react";
import { unescapeNoteText } from "../client/app";

/** Renders Talkie's own note Markdown as plain React text; no HTML from the note is ever injected. */
function inline(text: string, prefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((#[A-Za-z0-9_-]+)\)/g;
  let last = 0, match: RegExpExecArray | null, index = 0;
  while ((match = pattern.exec(text))) {
    parts.push(unescapeNoteText(text.slice(last, match.index)));
    parts.push(<a key={`${prefix}-${index++}`} href={`${match[2].replace(/^#/, `#${prefix}-`)}`}>{unescapeNoteText(match[1])}</a>);
    last = match.index + match[0].length;
  }
  parts.push(unescapeNoteText(text.slice(last)));
  return parts;
}

/** Shows a short turn label (e.g. "3번째 발화 · 나") instead of the stored turn ID. */
function evidenceLabel(meta: string) {
  const [id, role] = meta.split(" / ").map(v => v.trim());
  const turn = id.match(/-t(\d+)$/)?.[1];
  const who = role === "user" ? "나" : role === "assistant" ? "Talkie" : "";
  return [turn ? `${turn}번째 발화` : "대화 기록", who].filter(Boolean).join(" · ");
}

export function NoteView({ markdown, idPrefix }: { markdown: string; idPrefix: string }) {
  const blocks = markdown.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((block, i) => {
    const anchor = block.match(/^<a id="([A-Za-z0-9_-]+)"><\/a>$/);
    if (anchor) {
      // Anchors follow their heading; attach as a target just before the next content.
      out.push(<span key={i} id={`${idPrefix}-${anchor[1]}`} className="note-anchor" />);
      return;
    }
    if (block.startsWith("노트 형식:")) return;
    const heading = block.match(/^(#{1,4}) (.*)$/);
    if (heading) {
      const level = heading[1].length, text = inline(heading[2], idPrefix);
      if (level === 1) return; // The page shows its own title.
      const Tag = (["h3", "h3", "h4", "h5"] as const)[level - 1];
      out.push(<Tag key={i} className={`note-h${level}`}>{text}</Tag>);
      return;
    }
    if (block.startsWith("> ")) { out.push(<blockquote key={i}>{inline(block.replace(/^> ?/gm, ""), idPrefix)}</blockquote>); return; }
    if (block.startsWith("발화:") || block.startsWith("근거:")) {
      const [meta, ...rest] = block.split("\n");
      out.push(<Fragment key={i}><p className="note-evidence">근거 발화 · {evidenceLabel(unescapeNoteText(meta.replace(/^(발화|근거):\s*/, "")))}</p>
        {rest.length > 0 && <blockquote>{inline(rest.join("\n").replace(/^> ?/gm, "").trim(), idPrefix)}</blockquote>}</Fragment>);
      return;
    }
    if (/^- /m.test(block) && block.split("\n").every(l => l.startsWith("- "))) {
      out.push(<ul key={i}>{block.split("\n").map((l, j) => <li key={j}>{inline(l.slice(2), idPrefix)}</li>)}</ul>);
      return;
    }
    const label = block.match(/^(내용|관찰|확인된 연습일|설명): ?([\s\S]*)$/);
    if (label) { out.push(<p key={i} className="note-field"><span>{label[1]}</span>{inline(label[2], idPrefix)}</p>); return; }
    out.push(<p key={i}>{inline(block, idPrefix)}</p>);
  });
  return <div className="note-view">{out}</div>;
}
