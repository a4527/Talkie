"use client";
import { apiErrorMessages } from "../../client/api-error-messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "../../components/conversation";
import { FakeProvider, type DemoScenario } from "../../learning/fake-provider";
import { LearningSession } from "../../learning/session";
import type { LearningSessionState, LearningRecordsResponse, ConversationSnapshot } from "../../learning/types";

async function requestLearningAction(data: Record<string, unknown>) {
  const res = await fetch("/api/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error);
  return result;
}
type LearningRuntime = { session: LearningSession; provider: FakeProvider; learningSessionId: string; learningConnectionToken: string; confirmedSaveSequenceNumber: number };

function StoredConversation({ value, onReset, onSaved }: { value: LearningRuntime; onReset: () => void; onSaved: () => void }) {
  const [statusMessage, setStatusMessage] = useState("저장 준비 중");
  const latest = useRef<LearningSessionState>(value.session.getSnapshot());
  const stopped = useRef(false);
  const saveSequenceNumber = useRef(value.confirmedSaveSequenceNumber);
  const pending = useRef<{ saveSequenceNumber: number; conversationSnapshot: ConversationSnapshot; key: string } | undefined>(undefined);
  const savedKey = useRef("");
  const ended = useRef(false);
  const running = useRef(false);
  const sync = useCallback(async () => {
    if (running.current || stopped.current) return;
    running.current = true;
    const base = { learningSessionId: value.learningSessionId, learningConnectionToken: value.learningConnectionToken };
    try {
      const state = latest.current;
      if (state.phase === "ended" && !ended.current) { await requestLearningAction({ action: "end", ...base }); ended.current = true; }
      const conversationSnapshot = { turns: state.turns, corrections: state.corrections, learningState: state.learningState, hasConversationGaps: state.hasConversationGaps === true };
      const key = JSON.stringify(conversationSnapshot);
      if (!pending.current && key !== savedKey.current) pending.current = { saveSequenceNumber: saveSequenceNumber.current + 1, conversationSnapshot, key };
      if (pending.current) {
        const save = pending.current;
        await requestLearningAction({ action: "save", ...base, saveSequenceNumber: save.saveSequenceNumber, conversationSnapshot: save.conversationSnapshot });
        value.session.acknowledge(save.conversationSnapshot.turns);
        saveSequenceNumber.current = save.saveSequenceNumber; savedKey.current = save.key; pending.current = undefined;
      }
      setStatusMessage(state.hasConversationGaps ? "저장 완료 · 일부 대화 기록 누락" : "저장 완료");
      if (state.phase === "ended" && savedKey.current === key && !pending.current) {
        await requestLearningAction({ action: "note", learningSessionId: value.learningSessionId });
        stopped.current = true;
        setStatusMessage(state.hasConversationGaps ? "저장 완료 · 일부 대화가 누락된 노트입니다." : "저장과 노트 정리를 마쳤습니다.");
        onSaved();
      }
    } catch (error) {
      const code = (error as Error).message;
      setStatusMessage(apiErrorMessages[code] ?? "저장 실패 · 대화는 계속할 수 있습니다. 미저장 기록은 자동으로 다시 저장합니다.");
      if (["LOGIN_REQUIRED", "CONNECTION_EXPIRED", "SESSION_CLOSED"].includes(code)) stopped.current = true;
    } finally { running.current = false; }
  }, [value, onSaved]);
  useEffect(() => {
    const unsubscribe = value.session.subscribe(() => { latest.current = value.session.getSnapshot(); if (latest.current.phase === "ended") void sync(); });
    const saver = setInterval(() => void sync(), 5000);
    const heartbeatTimer = setInterval(() => { if (!stopped.current) void requestLearningAction({ action: "heartbeat", learningSessionId: value.learningSessionId, learningConnectionToken: value.learningConnectionToken }).catch(() => setStatusMessage("연결 확인에 실패했습니다. 저장 상태를 확인해 주세요.")); }, 15_000);
    const leave = () => {
      if (!stopped.current) navigator.sendBeacon("/api/learn", new Blob([JSON.stringify({ action: "pause", learningSessionId: value.learningSessionId, learningConnectionToken: value.learningConnectionToken })], { type: "application/json" }));
    };
    window.addEventListener("pagehide", leave);
    return () => { unsubscribe(); clearInterval(saver); clearInterval(heartbeatTimer); window.removeEventListener("pagehide", leave); };
  }, [value, sync]);
  return <><p className="save-status" role="status">{statusMessage}</p>
    <Conversation session={value.session} provider={value.provider} onReset={onReset} persistent /></>;
}

export default function Learn() {
  const [records, setRecords] = useState<LearningRecordsResponse>();
  const [runtime, setRuntime] = useState<LearningRuntime>();
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { void fetch("/api/learn").then(async r => {
    if (!r.ok) throw new Error((await r.json()).error);
    setRecords(await r.json());
  }).catch(error => setStatusMessage(apiErrorMessages[error.message] ?? "기록을 불러올 수 없습니다.")); }, []);
  useEffect(load, [load]);
  async function start() {
    setBusy(true); setStatusMessage("");
    try {
      const result = await requestLearningAction({ action: "start", scenario: "correction" });
      const provider = new FakeProvider(result.demoScenario as DemoScenario);
      const session = new LearningSession(provider, undefined, undefined, { learningSessionId: result.learningSessionId, ...result.conversationSnapshot, maxBytes: 128 * 1024 });
      setRuntime({ session, provider, learningSessionId: result.learningSessionId, learningConnectionToken: result.learningConnectionToken, confirmedSaveSequenceNumber: result.confirmedSaveSequenceNumber });
      if (session.getSnapshot().phase === "ready") session.start();
    } catch (error) { setStatusMessage(apiErrorMessages[(error as Error).message] ?? "학습을 시작할 수 없습니다."); }
    finally { setBusy(false); }
  }
  function download(date: string) {
    const text = records?.notes.filter(n => n.learningEndDateKst === date).map(n => n.noteMarkdown).join("\n---\n") ?? "";
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${date}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="shell"><header className="site-header"><a className="brand" href="/">talkie.</a><a href="/account">내 계정</a></header>
    <p className="demo-notice">가짜 AI로 학습하며 확인된 대화를 로컬 서버에 저장합니다. 실제 음성은 별도의 비공개 시험 화면에서 확인합니다.</p>
    <p><a href="/voice">본인 음성으로 Gemini Live 시험하기</a></p>
    <p role="status">{statusMessage}</p>
    {runtime ? <StoredConversation value={runtime} onSaved={load} onReset={() => { setRuntime(undefined); load(); }} />
      : records && <section className="card account-card"><p>{records.emailAddress}</p><button className="primary" disabled={busy} onClick={() => void start()}>학습 시작·이어서 하기</button></section>}
    {records && <section className="card account-card"><h2>내 학습 노트</h2>{[...new Set(records.notes.map(n => n.learningEndDateKst))].map(date => <div key={date}><button className="secondary" onClick={() => download(date)}>{date} 노트 다운로드</button></div>)}
      {!records.notes.length && <p>저장된 노트가 없습니다.</p>}
      {records.sessions.some(s => s.learningSessionStatus === "ended" && !["ready", "empty", "expired"].includes(s.noteGenerationStatus)) && <p>노트를 정리하고 있습니다.</p>}
    </section>}
  </main>;
}
