"use client";
import { useEffect, useRef, useState } from "react";
import { requestVoiceConnectionToken } from "../../client/voice";
import { requestLearningAction, VoiceLearningStore, type StoredVoiceSession } from "../../client/learning";
import { apiErrorMessages } from "../../client/api-error-messages";
import { createBrowserCascadeProviders } from "../../voice/cascade/browser-providers";
import { createVoicePort } from "../../voice/create-port";
import { VoicePlayback } from "../../voice/playback";
import { BrowserAudio } from "../../voice/browser-audio";
import type { VoicePort } from "../../voice/port";
import { VoiceLearningRecords } from "../../voice/learning";
import type { ConversationSnapshot, LearningRecordsResponse } from "../../learning/types";
import { updateVoiceTranscriptTurns, type VoiceTranscriptTurn } from "../../voice/transcript";

const voiceErrorMessages: Record<string, string> = {
  ...apiErrorMessages,
  LOGIN_REQUIRED: "먼저 내 계정에서 로컬 테스트 계정으로 로그인해 주세요.",
  VOICE_TEST_DISABLED: "서버의 무료 음성 시험 설정을 확인해 주세요.",
  VOICE_KEY_REQUIRED: "서버에 선택한 음성 경로의 API 키가 필요합니다.",
  VOICE_TEST_WAIT: "앱의 시험용 재연결 제한입니다. 이전 시작 시도에서 4분 뒤 다시 시작할 수 있습니다.",
};
type Persistence = { store: VoiceLearningStore; records: VoiceLearningRecords; action?: "pause" | "end"; busy: boolean; timer?: ReturnType<typeof setInterval> };
type VoiceRuntime = { port: VoicePort; audio: BrowserAudio; abort: AbortController; persistence?: Persistence; playback?: VoicePlayback; timer?: ReturnType<typeof setTimeout> };
export default function VoiceTest() {
  const [accepted, setAccepted] = useState(false);
  const [provider, setProvider] = useState<"gemini-live" | "cascade">("gemini-live");
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stored, setStored] = useState(false);
  const [statusMessage, setStatusMessage] = useState("시작하면 마이크 권한을 요청합니다. 이어폰 사용을 권장합니다.");
  const [saveMessage, setSaveMessage] = useState("");
  const [records, setRecords] = useState<VoiceTranscriptTurn[]>([]);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>();
  const [notes, setNotes] = useState<LearningRecordsResponse["notes"]>([]);
  const runtime = useRef<VoiceRuntime | undefined>(undefined);
  const persistence = useRef<Persistence | undefined>(undefined);
  async function sync(value: Persistence) {
    if (value.busy || persistence.current !== value) return;
    value.busy = true;
    const action = value.action;
    try {
      const snapshot = value.records.getSnapshot();
      await value.store.sync(snapshot, action);
      value.records.acknowledge(snapshot);
      if (persistence.current !== value) return;
      setSaveMessage(action === "end" ? "저장과 노트 정리를 마쳤습니다." : "저장 완료");
      if (action) {
        clearInterval(value.timer); persistence.current = undefined; setSaving(false);
        if (action === "end") {
          const response = await fetch("/api/learn");
          if (response.ok) setNotes((await response.json()).notes);
        }
      }
    } catch (error) {
      if (persistence.current !== value) return;
      const code = error instanceof Error ? error.message : "";
      setSaveMessage(voiceErrorMessages[code] ?? "저장 실패 · 이 화면을 유지하면 미저장 기록을 자동으로 다시 저장합니다.");
      if (["LOGIN_REQUIRED", "CONNECTION_EXPIRED", "SESSION_CLOSED", "NOT_FOUND"].includes(code)) {
        clearInterval(value.timer); persistence.current = undefined; setSaving(false);
        stop();
      }
    } finally { value.busy = false; }
  }
  function stop(action: "pause" | "end" = "pause") {
    const current = runtime.current;
    runtime.current = undefined;
    if (!current) return;
    clearTimeout(current.timer); current.abort.abort(); current.playback?.close(); current.port.close(); current.audio.close();
    setActive(false);
    if (current.persistence && persistence.current === current.persistence) {
      current.persistence.action = action; setSaving(true);
      void sync(current.persistence);
    }
  }
  useEffect(() => {
    const leave = () => {
      const value = persistence.current;
      if (value && value.action !== "end") navigator.sendBeacon("/api/learn", new Blob([JSON.stringify({ action: "pause", learningSessionId: value.store.session.learningSessionId, learningConnectionToken: value.store.session.learningConnectionToken })], { type: "application/json" }));
      stop();
    };
    window.addEventListener("pagehide", leave);
    const visibility = () => { if (document.hidden) { stop(); setStatusMessage("화면을 벗어나 음성 연결을 중단했습니다."); } };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", visibility);
      leave(); clearInterval(persistence.current?.timer); persistence.current = undefined;
    };
  }, []);
  async function start(learning = false) {
    if (runtime.current || persistence.current || !accepted) return;
    setRecords([]); setSnapshot(undefined); setNotes([]); setStored(learning); setSaveMessage("");
    setActive(true); setStatusMessage("마이크와 음성 연결을 준비하고 있습니다.");
    const audio = new BrowserAudio(), abort = new AbortController();
    const current: VoiceRuntime = { audio, abort, port: { connect: async () => {}, sendAudio: () => {}, close: () => {} } };
    runtime.current = current;
    try {
      await audio.open((pcm, rate) => current.port.sendAudio(pcm, rate));
      if (runtime.current !== current) return;
      if (learning) {
        const session: StoredVoiceSession = await requestLearningAction({ action: "start", scenario: "voice" });
        if (runtime.current !== current) {
          await requestLearningAction({ action: "pause", learningSessionId: session.learningSessionId, learningConnectionToken: session.learningConnectionToken }); return;
        }
        const value: Persistence = { store: new VoiceLearningStore(session), records: new VoiceLearningRecords(session.conversationSnapshot), busy: false };
        current.persistence = value; persistence.current = value;
        setSnapshot(value.records.getSnapshot());
        setRecords(value.records.getSnapshot().turns.map(t => ({ turnId: t.turnId, role: t.role, text: t.text, delivery: "played" })));
        value.timer = setInterval(() => void sync(value), 5000);
      }
      const data = provider === "cascade" ? await (async () => {
        const response = await fetch("/api/voice/cascade", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
          body: JSON.stringify({ action: "credential", testOnly: true, ...current.persistence?.store.session }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
      })() : await requestVoiceConnectionToken(abort.signal, current.persistence?.store.session);
      if (runtime.current !== current) return;
      current.playback = new VoicePlayback(audio, turnId => {
        if (runtime.current !== current) return;
        current.port.acknowledgePlayback?.(turnId);
        const event = { type: "played" as const, turnId };
        setRecords(previous => updateVoiceTranscriptTurns(previous, event));
        current.persistence?.records.apply(event);
        if (current.persistence) setSnapshot(current.persistence.records.getSnapshot());
      });
      current.port = createVoicePort(provider === "cascade"
        ? { provider: "cascade", providers: createBrowserCascadeProviders(data.temporarySttKey, data.cascadeRequestToken, current.persistence?.store.session), learning }
        : { provider: "gemini-live", credential: { voiceConnectionToken: data.voiceConnectionToken, learning } }, event => {
        if (runtime.current !== current) return;
        current.persistence?.records.apply(event);
        if (current.persistence) setSnapshot(current.persistence.records.getSnapshot());
        if (event.type === "connected") setStatusMessage("대화 중 · 가상의 일상 이야기로 영어 한 문장을 말해 보세요. 최대 3분 후 연결을 중단합니다.");
        if (event.type === "transcript" || event.type === "interrupted") setRecords(previous => updateVoiceTranscriptTurns(previous, event));
        try { current.playback?.handle(event); } catch { stop(); setStatusMessage("재생이 지연되어 연결을 중단했습니다."); }
        if (event.type === "error") { setStatusMessage(event.code === "billing" ? "Soniox 계정의 결제·크레딧 상태 때문에 전사를 시작하지 못했습니다." : "음성 연결에 실패했습니다. 키·무료 한도·네트워크 상태를 확인해 주세요."); stop(); }
        if (event.type === "closed") { setStatusMessage("음성 연결이 종료되었습니다."); stop(); }
      });
      current.timer = setTimeout(() => { stop(); setStatusMessage(learning ? "3분 연결을 중단했습니다. 저장된 학습은 이어서 할 수 있습니다." : "3분 시험을 마쳤습니다."); }, Math.min(Number(data.testDurationSeconds) || 180, 180) * 1000);
      await current.port.connect(current.persistence?.records.getSnapshot(), data.priorLearningContext);
    } catch (error) {
      if (runtime.current !== current) return;
      const code = error instanceof Error ? error.message : "";
      stop(); setStatusMessage(voiceErrorMessages[code] ?? "연결하지 못했습니다. 마이크 권한·키·무료 한도·네트워크 상태를 확인해 주세요.");
    }
  }
  function download(date: string) {
    const content = notes.filter(n => n.learningEndDateKst === date).map(n => n.noteMarkdown).join("\n---\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${date}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="shell">
    <header className="site-header"><a className="brand" href="/">talkie.</a><a href="/account">내 계정</a></header>
    <section className="card account-card">
      <h1>음성 대화 시험</h1>
      <p>개발자 본인만 사용하는 비공개 시험입니다. 선택한 경로에 따라 Soniox와 Google이 음성·대화를 처리합니다. 공급자의 데이터 사용 조건을 확인해 주세요. 개인정보·민감정보·기밀정보는 말하지 마세요.</p>
      <p>음성 시험은 화면 메모리만 사용합니다. 저장 학습은 확인된 전사문·교정·재시도를 계정에 저장하고, 이어서 하기와 종료 후 근거 노트를 지원합니다. 원본 음성은 저장하지 않습니다.</p>
      <label><input type="checkbox" checked={accepted} disabled={active || saving} onChange={event => setAccepted(event.target.checked)} /> 본인 음성·가상 대화로 시험하며 공급자의 학습 사용 조건을 확인했습니다.</label>
      <p role="status">{statusMessage}</p>
      {saveMessage && <p role="status">{saveMessage}</p>}
      <label>음성 경로 <select value={provider} disabled={active || saving} onChange={event => setProvider(event.target.value as "cascade" | "gemini-live")}>
        <option value="gemini-live">Gemini Live</option><option value="cascade">분리형 음성</option>
      </select></label>
      <div className="session-actions">
        <button className="primary" disabled={!accepted || active || saving} onClick={() => void start()}>음성 시험 시작</button>
        <button className="primary" disabled={!accepted || active || saving} onClick={() => void start(true)}>저장 학습 시작·이어서 하기</button>
        {stored && <button className="secondary" disabled={!active} onClick={() => { stop(); setStatusMessage("학습을 중단했습니다. 저장된 대화부터 이어서 할 수 있습니다."); }}>학습 중단</button>}
        <button className="secondary" disabled={!active} onClick={() => { stop(stored ? "end" : "pause"); setStatusMessage(stored ? "학습을 종료하고 노트를 정리합니다." : "음성 시험을 종료했습니다."); }}>{stored ? "학습 종료" : "시험 종료"}</button>
      </div>
      <p><a href="/learn">내 학습 노트·텍스트 데모</a></p>
    </section>
    <section className="card account-card" aria-label="음성 전사문">
      <h2>대화</h2><p>AI 전사문은 생성 결과입니다. 재생 완료 표시는 기기의 재생 완료 신호이며 실제 청취·학습 성공을 뜻하지 않습니다. 중단 응답은 전체를 근거에서 제외합니다.</p>
      <div role="log" aria-live="polite">{records.map(record => <div className={`turn ${record.role}`} key={record.turnId}>
        <span className="speaker">{record.role === "user" ? "나 · 전사" : `Talkie · ${record.delivery === "played" ? "재생 완료" : record.delivery === "interrupted" ? "중단 · 근거 제외" : "재생 미확인"}`}</span><p>{record.text}</p>
      </div>)}</div>
      {snapshot && <><h2>{snapshot.learningState === "retry" ? "다시 말해 보기" : "학습 기록"}</h2>
        <p>다시 말하기는 선택입니다. 다른 이야기로 계속해도 됩니다.</p>
        {snapshot.hasConversationGaps && <p>일부 대화 기록이 누락됐습니다.</p>}
        {snapshot.corrections.map(c => <div key={c.correctionId}><p>{c.replacement}</p><p>{c.explanation}</p>{c.attempts.map(a => <p key={a.turnId}>AI 재시도 판정: {a.outcome === "success" ? "성공" : "실패"}</p>)}</div>)}</>}
    </section>
    {notes.length > 0 && <section className="card account-card"><h2>내 학습 노트</h2><p>현재 노트는 저장된 근거와 교정을 모읍니다. 전체 대화의 AI 선별·요약은 후속입니다.</p>
      {[...new Set(notes.map(n => n.learningEndDateKst))].map(date => <div key={date}><button className="secondary" onClick={() => download(date)}>{date} 노트 다운로드</button></div>)}
      {notes.map((n, index) => <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} key={index}>{n.noteMarkdown}</pre>)}
    </section>}
  </main>;
}
