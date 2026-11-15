"use client";
import Link from "next/link";
import { use } from "react";
import { useRecords } from "../../../client/app";
import { AppFooter, AppHeader } from "../../../components/app-header";
import { MissionResult } from "../../../components/mission-result";

/** A finished mission's result. The aggregate stays until account deletion; criterion details expire with the note. */
export default function ResultPage({ params }: { params: Promise<{ learningSessionId: string }> }) {
  const { learningSessionId } = use(params);
  const [records] = useRecords();
  const session = records.status === "ready" ? records.value.sessions.find(s => s.learningSessionId === learningSessionId && s.mission && s.learningSessionStatus === "ended") : undefined;
  const note = records.status === "ready" ? records.value.notes.find(n => n.learningSessionId === learningSessionId) : undefined;
  return <main className="shell">
    <AppHeader />
    <section className="page-title">
      <Link className="text-link" href="/home">← 홈</Link>
      <span className="eyebrow">MISSION RESULT</span><h1>미션 결과<span>.</span></h1>
    </section>
    {records.status === "loading" && <p className="loading" role="status">불러오는 중…</p>}
    {records.status === "error" && <p role="status" className="form-status">{records.message}</p>}
    {records.status === "ready" && (session ? <>
      <MissionResult session={session} catalog={records.value.missions} />
      {note && <p className="button-row"><Link className="secondary" href={`/notes/${note.learningEndDateKst}`}>이 미션의 노트 보기</Link></p>}
    </> : <div className="card empty-card"><p>마친 미션의 결과를 찾을 수 없어요.</p></div>)}
    <AppFooter />
  </main>;
}
