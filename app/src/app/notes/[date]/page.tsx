"use client";
import Link from "next/link";
import { use } from "react";
import { downloadMarkdown, formatKoreanDate, useRecords } from "../../../client/app";
import { AppFooter, AppHeader } from "../../../components/app-header";
import { NoteView } from "../../../components/note-view";

export default function NoteDay({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const [records] = useRecords();
  const notes = records.status === "ready" ? records.value.notes.filter(n => n.learningEndDateKst === date) : [];
  return <main className="shell">
    <AppHeader />
    <section className="page-title note-title">
      <Link className="text-link" href="/notes">← 노트 목록</Link>
      <span className="eyebrow">LEARNING NOTE · {date}</span><h1>{valid ? formatKoreanDate(date) : "노트"}<span>.</span></h1>
      {notes.length > 0 && <button className="primary" onClick={() => downloadMarkdown(`${date}.md`, notes.map(n => n.noteMarkdown).join("\n---\n"))}>Markdown 다운로드 <span aria-hidden="true">↓</span></button>}
    </section>
    {records.status === "loading" && <p className="loading" role="status">불러오는 중…</p>}
    {records.status === "error" && <p role="status" className="form-status">{records.message}</p>}
    {records.status === "ready" && !notes.length && <div className="card empty-card"><p>이 날짜의 노트가 없거나 보관 기간이 지났어요.</p></div>}
    {notes.map((note, index) => <article key={note.learningSessionId} className="card note-article" aria-label={`대화 ${index + 1}의 노트`}>
      <span className="eyebrow">CONVERSATION {String(index + 1).padStart(2, "0")}</span>
      <NoteView markdown={note.noteMarkdown} idPrefix={`n${index + 1}`} />
    </article>)}
    <AppFooter />
  </main>;
}
