"use client";
import Link from "next/link";
import { formatKoreanDate, modeLabel, notePreview, notesByDate, useRecords } from "../../client/app";
import { AppFooter, AppHeader } from "../../components/app-header";


export default function Home() {
  const [records] = useRecords();
  const value = records.status === "ready" ? records.value : undefined;
  const open = value?.sessions.find(s => s.learningSessionStatus === "active" || s.learningSessionStatus === "interrupted");
  const days = value ? notesByDate(value.notes) : [];
  const ended = value?.sessions.filter(s => s.learningSessionStatus === "ended").length ?? 0;
  const preparing = value?.sessions.some(s => s.learningSessionStatus === "ended" && ["waiting_save", "pending"].includes(s.noteGenerationStatus));
  return <main className="shell">
    <AppHeader />
    {records.status === "error" && <p role="status" className="form-status">{records.message}</p>}
    {records.status === "loading" && <p className="loading" role="status">불러오는 중…</p>}
    {value && <>
      <section className="home-hero">
        <div><span className="eyebrow">TODAY</span><h1>오늘도 영어 한 걸음<span>.</span></h1><p className="muted-text">{value.emailAddress}</p></div>
        <div className={`card start-card ${open ? "resume" : ""}`}>
          {open ? <>
            <span className="eyebrow">IN PROGRESS</span><h2>멈춘 대화가 있어요</h2>
            <p>{modeLabel(open.demoScenario)} · {new Date(open.learningSessionStartedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} 시작</p>
            <p className="hint">저장된 마지막 대화부터 이어갈 수 있어요. 24시간 동안 돌아오지 않으면 자동으로 마치고 노트를 정리해요.</p>
            <Link className="primary wide" href="/talk">이어서 하기 <span aria-hidden="true">↗</span></Link>
          </> : <>
            <span className="eyebrow">TODAY’S CONVERSATION</span><h2>오늘의 대화를 시작해요</h2>
            <p>짧게 이야기하고, 표현 하나를 다시 말해 보고, 노트로 남겨요.</p>
            <Link className="primary wide" href="/talk">대화 시작 <span aria-hidden="true">↗</span></Link>
          </>}
        </div>
      </section>
      <section className="stats" aria-label="학습 요약">
        <div className="stat"><strong>{ended}</strong><span>마친 대화</span></div>
        <div className="stat"><strong>{days.length}</strong><span>노트가 있는 날</span></div>
        <div className="stat"><strong>{days[0] ? formatKoreanDate(days[0][0]) : "—"}</strong><span>마지막 학습</span></div>
      </section>
      <section className="section-block">
        <div className="section-head"><h2>최근 학습 노트</h2>{days.length > 0 && <Link className="text-link" href="/notes">전체 보기 →</Link>}</div>
        {preparing && <p className="notice-line" role="status">방금 마친 대화의 노트를 정리하고 있어요.</p>}
        {days.length ? <div className="note-grid">{days.slice(0, 3).map(([date, notes]) => <Link key={date} className="card note-tile" href={`/notes/${date}`}>
          <span className="note-date">{formatKoreanDate(date)}</span><h3>노트 {notes.length}개</h3><p>{notes.map(n => notePreview(n.noteMarkdown)).find(Boolean) || "대화 근거와 표현을 확인해 보세요."}</p><span className="tile-arrow" aria-hidden="true">↗</span>
        </Link>)}</div> : <div className="card empty-card"><p>아직 노트가 없어요. 첫 대화를 마치면 이곳에 학습 노트가 쌓여요.</p></div>}
      </section>
    </>}
    <AppFooter />
  </main>;
}
