"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { errorMessage, modeLabel, useRecords } from "../../client/app";
import { requestLearningAction } from "../../client/learning";
import { AppFooter, AppHeader } from "../../components/app-header";
import { SessionFeedback } from "../../components/session-feedback";
import { StoredTextConversation, type LearningRuntime } from "../../components/stored-text-conversation";
import { useVoiceLearning, type VoiceRoute } from "../../components/use-voice-learning";
import { FakeProvider, type DemoScenario } from "../../learning/fake-provider";
import { LearningSession } from "../../learning/session";
import type { ConversationSnapshot } from "../../learning/types";
import { cascadeLlmChoices, cascadeSttChoices, cascadeTtsChoices, defaultCascadeSelection, type CascadeSelection } from "../../voice/cascade/selection";
import type { VoiceTranscriptTurn } from "../../voice/transcript";

type Mode = "voice" | "text";
type View = { kind: "setup" } | { kind: "text"; runtime: LearningRuntime } | { kind: "feedback"; learningSessionId: string };

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  return <span className={`countdown ${left <= 30 ? "low" : ""}`} aria-label={`남은 연결 시간 ${Math.floor(left / 60)}분 ${left % 60}초`}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>;
}

function deliveryLabel(turn: VoiceTranscriptTurn) {
  if (turn.role === "user") return "나";
  return turn.delivery === "interrupted" ? "Talkie · 중간에 멈춤" : turn.delivery === "played" ? "Talkie" : "Talkie · 말하는 중";
}

function ExpressionCard({ snapshot }: { snapshot?: ConversationSnapshot }) {
  const correction = snapshot?.corrections.at(-1);
  const source = correction && snapshot?.turns.find(t => t.turnId === correction.sourceTurnId);
  const last = correction?.attempts.at(-1);
  return <section className="card practice" aria-label="오늘의 표현">
    <span className="eyebrow">ONE EXPRESSION AT A TIME</span>
    <h2>{snapshot?.learningState === "retry" ? "다시 말해 보기" : "오늘의 표현"}</h2>
    {correction ? <>
      {source && <><p className="small-label">내가 말한 문장</p><blockquote>{source.text}</blockquote></>}
      <p className="small-label">이렇게 말해 보세요</p>
      <p className="expression">{correction.replacement}</p>
      {correction.explanation && <p className="explanation">{correction.explanation}</p>}
      <p className="attempt-status">{last ? `AI 재시도 판정: ${last.outcome === "success" ? "성공" : "실패"}` : "다시 말하기는 선택이에요. 다른 이야기로 계속해도 돼요."}</p>
    </> : <><div className="expression-placeholder" aria-hidden="true">Aa<span>↗</span></div><p className="explanation">대화 중 연습할 표현이 생기면<br />이곳에 보여 드릴게요.</p></>}
    {snapshot?.hasConversationGaps && <p className="hint">일부 대화 기록이 누락됐어요.</p>}
  </section>;
}

export default function Talk() {
  const [records, reload] = useRecords();
  const [mode, setMode] = useState<Mode>("voice");
  const [route, setRoute] = useState<VoiceRoute>("gemini-live");
  const [cascadeSelection, setCascadeSelection] = useState<CascadeSelection>(defaultCascadeSelection);
  const [accepted, setAccepted] = useState(false);
  const [view, setView] = useState<View>({ kind: "setup" });
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const voice = useVoiceLearning({ onEnded: learningSessionId => setView({ kind: "feedback", learningSessionId }) });
  const bottom = useRef<HTMLDivElement>(null);
  const live = voice.phase !== "idle";

  const value = records.status === "ready" ? records.value : undefined;
  const open = value?.sessions.find(s => s.learningSessionStatus === "active" || s.learningSessionStatus === "interrupted");
  const lockedMode: Mode | undefined = open ? (open.demoScenario === "voice" ? "voice" : "text") : undefined;
  const effectiveMode = lockedMode ?? mode;

  useEffect(() => { if (voice.phase === "idle") void reload(); }, [voice.phase, reload]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [voice.transcript]);

  async function startText() {
    setBusy(true); setStatusMessage("");
    try {
      const result = await requestLearningAction({ action: "start", scenario: "correction" });
      const provider = new FakeProvider(result.demoScenario as DemoScenario);
      const session = new LearningSession(provider, undefined, undefined, { learningSessionId: result.learningSessionId, ...result.conversationSnapshot, maxBytes: 128 * 1024 });
      setView({ kind: "text", runtime: { session, provider, learningSessionId: result.learningSessionId, learningConnectionToken: result.learningConnectionToken, confirmedSaveSequenceNumber: result.confirmedSaveSequenceNumber } });
      if (session.getSnapshot().phase === "ready") session.start();
    } catch (error) { setStatusMessage(errorMessage(error, "대화를 시작할 수 없습니다.")); }
    finally { setBusy(false); }
  }
  function start() {
    setStatusMessage("");
    if (effectiveMode === "text") void startText();
    else voice.start(route, cascadeSelection);
  }
  function again() { setView({ kind: "setup" }); void reload(); }

  return <main className="shell">
    <AppHeader />
    {view.kind === "feedback" ? <SessionFeedback learningSessionId={view.learningSessionId} onAgain={again} />
      : view.kind === "text" ? <>
        <p className="demo-notice"><span aria-hidden="true">◌</span>텍스트 연습은 정해진 순서로 답하는 가짜 튜터를 사용해요. 확인된 대화는 계정에 저장돼요.</p>
        <StoredTextConversation value={view.runtime} onSaved={() => setView({ kind: "feedback", learningSessionId: view.runtime.learningSessionId })} onReset={again} />
      </>
      : live ? <div className="workspace">
        <section className="chat-panel" aria-label="음성 대화">
          <header className="panel-header">
            <div><span className="eyebrow">TODAY’S CONVERSATION</span><h2>오늘의 영어 대화</h2></div>
            <div className="live-meta">
              {voice.deadline && voice.phase === "live" && <Countdown deadline={voice.deadline} />}
              <span className={`status ${voice.phase === "live" ? "live" : "muted"}`}><span aria-hidden="true" />{voice.phase === "live" ? "대화 중" : voice.phase === "connecting" ? "연결 중" : "저장 중"}</span>
            </div>
          </header>
          <div className="messages" role="log" aria-label="대화 전사문" aria-live="polite">
            <p className="chat-intro">완벽한 문장보다, 한 문장부터 시작해요.</p>
            {voice.transcript.map(turn => <div className={`turn ${turn.role} ${turn.delivery === "interrupted" ? "interrupted" : ""}`} key={turn.turnId}>
              <span className="speaker">{deliveryLabel(turn)}</span><p>{turn.text}</p>
            </div>)}
            {voice.phase === "connecting" && <p className="waiting">연결하고 있어요<span aria-hidden="true"> · · ·</span></p>}
            <div ref={bottom} />
          </div>
          <div className="chat-footer">
            <div className={`mic-line ${voice.phase === "live" ? "on" : ""}`}><span className="mic-dot" aria-hidden="true" /><p role="status">{voice.statusMessage}</p></div>
            {voice.saveMessage && <p className="session-message" role="status">{voice.saveMessage}</p>}
            <div className="session-actions">
              <button className="text-button" disabled={voice.phase === "saving"} onClick={voice.pause}>잠시 멈추기</button>
              <button className="secondary end" disabled={voice.phase === "saving"} onClick={voice.end}>대화 종료</button>
            </div>
          </div>
        </section>
        <aside className="side-panel">
          <ExpressionCard snapshot={voice.snapshot} />
          <p className="memory-note">원본 음성은 저장하지 않아요. 확인된 전사문과 교정만 계정에 저장되고, 화면을 벗어나면 대화를 잠시 멈춰요.</p>
        </aside>
      </div>
      : <section className="talk-setup">
        <div className="page-title"><span className="eyebrow">START A CONVERSATION</span><h1>{open ? "멈춘 대화를 이어가요" : "어떻게 이야기할까요?"}<span>.</span></h1>
          {open && <p className="muted-text">{modeLabel(open.demoScenario)}이 진행 중이에요. 저장된 마지막 대화부터 이어집니다. 다른 방식은 이 대화를 마친 뒤 시작할 수 있어요.</p>}</div>
        <div className="mode-grid" role="radiogroup" aria-label="대화 방식">
          {([["voice", "음성 대화", "AI 튜터와 목소리로 이야기해요. 이어폰을 권장해요.", "🎙"], ["text", "텍스트 연습", "가짜 튜터와 글로 흐름을 연습해요. API 키 없이 동작해요.", "✎"]] as const).map(([key, title, body, icon]) =>
            <button key={key} role="radio" aria-checked={effectiveMode === key} className={`card mode-card ${effectiveMode === key ? "selected" : ""}`} disabled={Boolean(lockedMode && lockedMode !== key)} onClick={() => setMode(key)}>
              <span className="mode-icon" aria-hidden="true">{icon}</span><strong>{title}</strong><span>{body}</span>
            </button>)}
        </div>
        {effectiveMode === "voice" && <div className="card voice-options">
          <div className="option-row">
            <label>음성 경로 <select value={route} onChange={event => setRoute(event.target.value as VoiceRoute)}>
              <option value="gemini-live">Gemini Live</option><option value="cascade">분리형 음성</option>
            </select></label>
            <p className="hint">{route === "gemini-live" ? "하나의 실시간 모델이 듣고 말해요." : "음성 인식·대화·음성 합성을 각각 고른 공급자가 처리해요."}</p>
          </div>
          {route === "cascade" && <div className="cascade-selectors" aria-label="분리형 공급자 선택">
            <label>STT <select value={cascadeSelection.stt} onChange={event => setCascadeSelection(v => ({ ...v, stt: event.target.value as CascadeSelection["stt"] }))}>
              {cascadeSttChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select></label>
            <label>LLM <select value={cascadeSelection.llm} onChange={event => setCascadeSelection(v => ({ ...v, llm: event.target.value as CascadeSelection["llm"] }))}>
              {cascadeLlmChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select></label>
            <label>TTS <select value={cascadeSelection.tts} onChange={event => setCascadeSelection(v => ({ ...v, tts: event.target.value as CascadeSelection["tts"] }))}>
              {cascadeTtsChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select></label>
            {cascadeSelection.tts === "google-cloud-standard" && <p>Google Cloud Standard는 한국어가 포함된 답변에 한국어 음성, 그 외에는 영어 음성을 사용합니다. 별도 Cloud 프로젝트 인증이 필요합니다.</p>}
          </div>}
          <div className="consent">
            <p>선택한 경로에 따라 Google·Soniox가 음성과 대화를 처리해요. 원본 음성은 저장하지 않고, 확인된 전사문·교정만 계정에 저장해요. 개인정보·민감한 내용은 말하지 마세요. 한 번 연결은 최대 3분이며, 이어서 계속할 수 있어요.</p>
            <label className="check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> 위 내용과 공급자의 데이터 사용 조건을 확인했어요.</label>
          </div>
        </div>}
        <div className="start-row">
          <button className="primary start" disabled={busy || records.status !== "ready" || (effectiveMode === "voice" && !accepted)} onClick={start}>{open ? "이어서 하기" : "대화 시작"} <span aria-hidden="true">↗</span></button>
          <Link className="text-link" href="/home">홈으로</Link>
        </div>
        <p role="status" className="form-status">{statusMessage || voice.statusMessage}</p>
        {voice.saveMessage && <p role="status" className="form-status">{voice.saveMessage}</p>}
      </section>}
    <AppFooter />
  </main>;
}
