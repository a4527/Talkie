"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FakeProvider, type Scenario } from "../learning/fake-provider";
import { markdown } from "../learning/note";
import { LearningSession } from "../learning/session";
import type { Phase } from "../learning/types";

const labels: Record<Phase, string> = {
  ready: "시작 준비", conversation: "대화 중", waiting: "응답 기다리는 중",
  retry: "다시 말해 보기", paused: "일시 중단", ended: "대화 종료",
};

export function Conversation({ session, provider, onReset, persistent = false }: { session: LearningSession; provider: FakeProvider; onReset: () => void; persistent?: boolean }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [draft, setDraft] = useState("");
  const [replyFailure, setReplyFailure] = useState(false);
  const [noteFailure, setNoteFailure] = useState(false);
  const [slow, setSlow] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const canSend = state.phase === "conversation" || state.phase === "retry";
  const correction = state.corrections.at(-1);

  useEffect(() => {
    if (canSend) input.current?.focus();
  }, [canSend]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state.turns.length, state.phase]);

  function send() {
    if (session.send(draft)) {
      setDraft("");
      setReplyFailure(false);
    }
  }

  function download() {
    if (!state.note) return;
    const url = URL.createObjectURL(new Blob([markdown(state.note)], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.note.date}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="workspace">
    <section className="chat-panel" aria-label="영어 대화">
      <header className="panel-header">
        <div><span className="eyebrow">TODAY’S CONVERSATION</span><h2>어제의 작은 이야기</h2></div>
        <span className={`status ${state.phase === "paused" ? "muted" : ""}`}><span aria-hidden="true" />{labels[state.phase]}</span>
      </header>
      <div className="messages" role="log" aria-label="확인된 대화 기록" aria-live="polite" aria-relevant="additions">
        <p className="chat-intro">완벽한 문장보다, 한 문장부터 시작해요.</p>
        {state.turns.map(turn => <div className={`turn ${turn.role}`} key={turn.id}>
          <span className="speaker">{turn.role === "assistant" ? "T · Talkie 데모" : "나"}</span>
          <p>{turn.text}</p>
        </div>)}
        {state.pending?.text && <div className="turn user pending"><span className="speaker">나 · 응답 확인 대기</span><p>{state.pending.text}</p></div>}
        {state.phase === "waiting" && <p className="waiting">가짜 응답을 기다리고 있어요<span aria-hidden="true"> · · ·</span></p>}
        <div ref={bottom} />
      </div>
      <div className="chat-footer">
        <p className="session-message" role="status">{state.message || (state.phase === "retry" ? "표현을 다시 말해 보세요. 데모는 첫 재시도 실패 → 두 번째 성공 순서로 진행합니다." : "")}</p>
        {state.phase !== "ended" && <form onSubmit={e => { e.preventDefault(); send(); }}>
          <label htmlFor="answer">{state.phase === "retry" ? "다시 답변하기" : "내 답변"}</label>
          <div className="composer">
            <textarea id="answer" ref={input} rows={2} value={draft} disabled={!canSend} maxLength={persistent ? 6000 : undefined}
              placeholder="영어로 한 문장을 적어 보세요…" onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
              aria-describedby="input-help" />
            <button className="primary send" disabled={!canSend || !draft.trim()} type="submit">보내기 <span aria-hidden="true">↗</span></button>
          </div>
          <p id="input-help" className="hint">Enter로 보내기 · Shift + Enter로 줄바꿈</p>
        </form>}
        <div className="session-actions">
          {state.phase === "paused" ? <button className="secondary" onClick={() => { session.resume(); setReplyFailure(false); }}>이어서 하기</button>
            : state.phase !== "ended" && <button className="text-button" onClick={() => session.pause()}>잠시 멈추기</button>}
          {state.phase !== "ended" && <button className="text-button end" onClick={() => { session.end(); setNoteFailure(false); }}>대화 종료</button>}
          {state.phase === "ended" && <button className="secondary" onClick={onReset}>새 대화 준비</button>}
        </div>
      </div>
    </section>

    <aside className="side-panel">
      <section className="card practice">
        <span className="eyebrow">ONE EXPRESSION AT A TIME</span>
        <h2>오늘의 표현</h2>
        {correction ? <>
          <p className="small-label">내가 말한 문장</p>
          <blockquote>{state.turns.find(t => t.id === correction.sourceTurnId)?.text}</blockquote>
          <p className="small-label">시나리오의 연습 표현</p>
          <p className="expression">{correction.replacement}</p>
          <p className="explanation">{correction.explanation}</p>
          <p className="attempt-status">{correction.attempts.length ? `최근 재시도: ${correction.attempts.at(-1)?.outcome === "success" ? "성공" : "실패"} (고정 시나리오)` : "부담 없이, 한 번 더 말해 보세요."}</p>
        </> : <><div className="expression-placeholder" aria-hidden="true">Aa<span>↗</span></div><p className="explanation">대화 중 연습 표현이 도착하면<br />이곳에서 함께 살펴볼 수 있어요.</p></>}
      </section>

      {state.phase === "ended" && <section className="card note-card" aria-label="학습 노트">
        <span className="eyebrow">YOUR LEARNING NOTE</span><h2>오늘 남긴 한 걸음</h2>
        {state.noteStatus === "ready" && state.note ? <>
          <p className="note-date">{state.note.date} · 한국 시간 종료일</p>
          <p>확인된 내 답변 {state.note.evidence.length}개 · 연습 표현 {state.note.items.length}개</p>
          {!state.note.items.length && <p>확인된 교정이 없습니다.</p>}
          <details><summary>노트 내용 보기</summary><pre>{markdown(state.note)}</pre></details>
          <button className="primary" onClick={download}>Markdown 다운로드 <span aria-hidden="true">↓</span></button>
        </> : <p>{state.message}</p>}
        {!persistent && state.noteStatus === "failed" && <button className="secondary" onClick={() => { void session.generateNote(); setNoteFailure(false); }}>노트만 다시 만들기</button>}
      </section>}

      <details className="card demo-tools">
        <summary>데모 시나리오 확인</summary>
        <p>실제 장애가 아닌 가짜 공급자 시험입니다.</p>
        <label><input type="checkbox" checked={replyFailure} disabled={state.phase === "ended" || state.phase === "waiting"} onChange={e => { provider.failNextReply = e.target.checked; setReplyFailure(e.target.checked); }} /> 다음 응답 실패</label>
        <label><input type="checkbox" checked={noteFailure} disabled={state.phase === "ended" && state.noteStatus !== "failed"} onChange={e => { provider.failNextNote = e.target.checked; setNoteFailure(e.target.checked); }} /> 다음 노트 생성 실패</label>
        <label><input type="checkbox" checked={slow} onChange={e => { provider.delayMs = e.target.checked ? 3500 : 650; setSlow(e.target.checked); }} /> 느린 응답 (3.5초)</label>
        <details className="metrics"><summary>요청·상태·대기 시간 ({state.metrics.length})</summary>
          <p>가짜 공급자 측정 · 최근 100개 · 메모리만 사용</p>
          <ol>{state.metrics.map((m, i) => <li key={i}><code>{m.requestId.slice(-8)} · {m.event}<br />{m.from} → {m.to} · {m.result} · {m.elapsedMs}ms</code></li>)}</ol>
        </details>
      </details>
      <p className="memory-note">{persistent ? "저장 성공이 확인된 기록만 복원할 수 있습니다. 미저장 기록은 화면을 벗어나면 사라질 수 있습니다." : "이 화면을 벗어나거나 새로고침하면 기록이 사라집니다. 필요한 노트는 먼저 내려받으세요."}</p>
    </aside>
  </div>;
}
