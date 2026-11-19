"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatKoreanDate, notePreview, notesByDate, useRecords } from "../../client/app";
import { AppFooter, AppHeader } from "../../components/app-header";
import { EXPRESSION_KIND_LABEL, buildExpressionIndex, filterExpressions, noteDayMatches } from "../../learning/note-expressions";

type View = "days" | "expressions";

export default function Notes() {
  const [records] = useRecords();
  const [view, setView] = useState<View>("days");
  const [query, setQuery] = useState("");
  const notes = records.status === "ready" ? records.value.notes : null;
  const days = useMemo(() => notes ? notesByDate(notes) : [], [notes]);
  const expressions = useMemo(() => notes ? buildExpressionIndex(notes) : [], [notes]);
  const shownDays = days.filter(([date, dayNotes]) => noteDayMatches(date, dayNotes, query));
  const shownExpressions = filterExpressions(expressions, query);
  return <main className="shell">
    <AppHeader />
    <section className="page-title"><span className="eyebrow">MY LEARNING NOTES</span><h1>학습 노트<span>.</span></h1><p className="muted-text">대화를 마친 날짜(한국 시간)별로 모았어요. 노트는 실제로 말한 문장을 근거로 만들어요.</p></section>
    {records.status === "loading" && <p className="loading" role="status">불러오는 중…</p>}
    {records.status === "error" && <p role="status" className="form-status">{records.message}</p>}
    {records.status === "ready" && (days.length ? <>
      <div className="note-explore">
        <div className="view-switch" role="group" aria-label="노트 보기 방식">
          <button type="button" aria-pressed={view === "days"} onClick={() => { setView("days"); setQuery(""); }}>날짜별 노트 <span className="pill">{days.length}</span></button>
          <button type="button" aria-pressed={view === "expressions"} onClick={() => { setView("expressions"); setQuery(""); }}>표현 <span className="pill">{expressions.length}</span></button>
        </div>
        <label className="note-search"><span className="sr-only">{view === "days" ? "노트 검색" : "표현 검색"}</span>
          <input type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder={view === "days" ? "날짜(11-02)나 노트 내용으로 찾기" : "영어 표현으로 찾기"} /></label>
      </div>
      {view === "days" && (shownDays.length ? <ol className="note-list">{shownDays.map(([date, dayNotes]) => <li key={date}>
        <Link className="card note-row" href={`/notes/${date}`}>
          <span className="note-date">{date}</span>
          <div><h2>{formatKoreanDate(date)}</h2><p>{dayNotes.map(n => notePreview(n.noteMarkdown)).find(Boolean) || "대화 근거와 표현을 확인해 보세요."}</p></div>
          <span className="pill">노트 {dayNotes.length}개</span><span className="tile-arrow" aria-hidden="true">↗</span>
        </Link></li>)}</ol>
        : <p className="card empty-card" role="status">‘{query}’와 맞는 노트가 없어요.</p>)}
      {view === "expressions" && (shownExpressions.length ? <ul className="expression-list" aria-label="노트의 주요 표현">{shownExpressions.map(entry => <li key={entry.text} className="card expression-row">
        <p className="expression-text" lang="en">{entry.text}</p>
        <div className="expression-meta">
          {entry.kinds.map(kind => <span key={kind} className="pill">{EXPRESSION_KIND_LABEL[kind]}</span>)}
          {entry.dates.map(date => <Link key={date} className="text-link" href={`/notes/${date}`} aria-label={`${formatKoreanDate(date)} 노트 열기`}>{date}</Link>)}
        </div>
      </li>)}</ul>
        : <p className="card empty-card" role="status">{expressions.length ? `‘${query}’와 맞는 표현이 없어요.` : "노트에 정리된 표현이 아직 없어요."}</p>)}
    </>
      : <div className="card empty-card"><p>아직 노트가 없어요.</p><Link className="primary" href="/talk">첫 대화 시작 <span aria-hidden="true">↗</span></Link></div>)}
    <AppFooter />
  </main>;
}
