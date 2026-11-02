"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { requestLearningAction } from "../client/learning";
import { downloadMarkdown, formatKoreanDate, useRecords } from "../client/app";
import { NoteView } from "./note-view";

const SETTLED = ["ready", "empty", "expired"];

/** End-of-conversation screen: waits for the note of this session and shows it with a download. */
export function SessionFeedback({ learningSessionId, onAgain }: { learningSessionId: string; onAgain: () => void }) {
  const [records, reload] = useRecords();
  const [retrying, setRetrying] = useState(false);
  const polls = useRef(0);
  const session = records.status === "ready" ? records.value.sessions.find(s => s.learningSessionId === learningSessionId) : undefined;
  const note = records.status === "ready" ? records.value.notes.find(n => n.learningSessionId === learningSessionId) : undefined;
  const settled = session ? SETTLED.includes(session.noteGenerationStatus) : false;
  useEffect(() => {
    if (records.status !== "ready" || settled || polls.current > 40) return;
    const timer = setTimeout(() => { polls.current++; void reload(); }, 3000);
    return () => clearTimeout(timer);
  }, [records, settled, reload]);
  async function retry() {
    setRetrying(true);
    try { await requestLearningAction({ action: "note", learningSessionId }); } catch {}
    finally { setRetrying(false); await reload(); }
  }
  return <section className="feedback" aria-label="오늘의 피드백">
    <div className="feedback-head">
      <span className="eyebrow">WELL DONE</span>
      <h1>오늘의 대화를 마쳤어요<span>.</span></h1>
      <p className="muted-text">실제로 말한 문장을 근거로 정리한 노트예요. AI가 고른 내용이라 표현의 정확성을 보장하지는 않아요.</p>
    </div>
    <div className="card note-article">
      {note ? <>
        <div className="note-actions"><span className="note-date">{formatKoreanDate(note.learningEndDateKst)} · 한국 시간 종료일</span>
          <button className="primary" onClick={() => downloadMarkdown(`${note.learningEndDateKst}.md`, note.noteMarkdown)}>Markdown 다운로드 <span aria-hidden="true">↓</span></button></div>
        <NoteView markdown={note.noteMarkdown} idPrefix="feedback" />
      </> : session?.noteGenerationStatus === "empty" ? <p>저장된 발화가 없어 노트를 만들지 않았어요. 다음 대화에서 한 문장이라도 말해 보세요.</p>
        : session?.noteGenerationStatus === "expired" ? <p>노트를 만들 수 있는 기한이 지났어요.</p>
        : <div className="note-waiting" role="status"><span className="pulse" aria-hidden="true" /><p>대화를 돌아보며 노트를 정리하고 있어요…</p>
          {polls.current > 5 && <button className="secondary" disabled={retrying} onClick={() => void retry()}>노트 다시 정리하기</button>}</div>}
    </div>
    <div className="button-row">
      <button className="secondary" onClick={onAgain}>새 대화 시작</button>
      <Link className="secondary" href="/notes">노트 목록</Link>
      <Link className="primary" href="/home">홈으로 <span aria-hidden="true">↗</span></Link>
    </div>
  </section>;
}
