"use client";
import Link from "next/link";
import { formatKoreanDate, notePreview, notesByDate, useRecords } from "../../client/app";
import { AppFooter, AppHeader } from "../../components/app-header";

export default function Notes() {
  const [records] = useRecords();
  const days = records.status === "ready" ? notesByDate(records.value.notes) : [];
  return <main className="shell">
    <AppHeader />
    <section className="page-title"><span className="eyebrow">MY LEARNING NOTES</span><h1>학습 노트<span>.</span></h1><p className="muted-text">대화를 마친 날짜(한국 시간)별로 모았어요. 노트는 실제로 말한 문장을 근거로 만들어요.</p></section>
    {records.status === "loading" && <p className="loading" role="status">불러오는 중…</p>}
    {records.status === "error" && <p role="status" className="form-status">{records.message}</p>}
    {records.status === "ready" && (days.length ? <ol className="note-list">{days.map(([date, notes]) => <li key={date}>
      <Link className="card note-row" href={`/notes/${date}`}>
        <span className="note-date">{date}</span>
        <div><h2>{formatKoreanDate(date)}</h2><p>{notes.map(n => notePreview(n.noteMarkdown)).find(Boolean) || "대화 근거와 표현을 확인해 보세요."}</p></div>
        <span className="pill">노트 {notes.length}개</span><span className="tile-arrow" aria-hidden="true">↗</span>
      </Link></li>)}</ol>
      : <div className="card empty-card"><p>아직 노트가 없어요.</p><Link className="primary" href="/talk">첫 대화 시작 <span aria-hidden="true">↗</span></Link></div>)}
    <AppFooter />
  </main>;
}
