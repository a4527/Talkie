"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "../../components/conversation";
import { FakeProvider, type Scenario } from "../../learning/fake-provider";
import { LearningSession } from "../../learning/session";
import type { Session } from "../../learning/types";
import { messages } from "../../client/account";

async function api(data: Record<string, unknown>) {
  const res = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error);
  return result;
}
type Runtime = { session: LearningSession; provider: FakeProvider; id: string; secret: string; confirmedSaveSequenceNumber: number };
type Records = { email: string; notes: { date: string; markdown: string }[]; sessions: { id: string; status: string; noteStatus: string }[] };

function StoredConversation({ value, onReset, onSaved }: { value: Runtime; onReset: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState("저장 준비 중");
  const latest = useRef<Session>(value.session.getSnapshot());
  const stopped = useRef(false);
  const saveSequenceNumber = useRef(value.confirmedSaveSequenceNumber);
  const pending = useRef<{ saveSequenceNumber: number; conversationSnapshot: { turns: Session["turns"]; corrections: Session["corrections"]; learning: Session["learning"]; gaps: boolean }; key: string } | undefined>(undefined);
  const savedKey = useRef("");
  const ended = useRef(false);
  const running = useRef(false);
  const sync = useCallback(async () => {
    if (running.current || stopped.current) return;
    running.current = true;
    const base = { id: value.id, connection: value.secret };
    try {
      const state = latest.current;
      if (state.phase === "ended" && !ended.current) { await api({ action: "end", ...base }); ended.current = true; }
      const record = { turns: state.turns, corrections: state.corrections, learning: state.learning, gaps: state.gaps === true };
      const key = JSON.stringify(record);
      if (!pending.current && key !== savedKey.current) pending.current = { saveSequenceNumber: saveSequenceNumber.current + 1, conversationSnapshot: record, key };
      if (pending.current) {
        const save = pending.current;
        await api({ action: "save", ...base, saveSequenceNumber: save.saveSequenceNumber, conversationSnapshot: save.conversationSnapshot });
        value.session.acknowledge(save.conversationSnapshot.turns);
        saveSequenceNumber.current = save.saveSequenceNumber; savedKey.current = save.key; pending.current = undefined;
      }
      setStatus(state.gaps ? "저장 완료 · 일부 대화 기록 누락" : "저장 완료");
      if (state.phase === "ended" && savedKey.current === key && !pending.current) {
        await api({ action: "note", id: value.id });
        stopped.current = true;
        setStatus(state.gaps ? "저장 완료 · 일부 대화가 누락된 노트입니다." : "저장과 노트 정리를 마쳤습니다.");
        onSaved();
      }
    } catch (error) {
      const code = (error as Error).message;
      setStatus(messages[code] ?? "저장 실패 · 대화는 계속할 수 있습니다. 미저장 기록은 자동으로 다시 저장합니다.");
      if (["LOGIN_REQUIRED", "CONNECTION_EXPIRED", "SESSION_CLOSED"].includes(code)) stopped.current = true;
    } finally { running.current = false; }
  }, [value, onSaved]);
  useEffect(() => {
    const unsubscribe = value.session.subscribe(() => { latest.current = value.session.getSnapshot(); if (latest.current.phase === "ended") void sync(); });
    const saver = setInterval(() => void sync(), 5000);
    const heartbeat = setInterval(() => { if (!stopped.current) void api({ action: "heartbeat", id: value.id, connection: value.secret }).catch(() => setStatus("연결 확인에 실패했습니다. 저장 상태를 확인해 주세요.")); }, 15_000);
    const leave = () => {
      if (!stopped.current) navigator.sendBeacon("/api/learning", new Blob([JSON.stringify({ action: "pause", id: value.id, connection: value.secret })], { type: "application/json" }));
    };
    window.addEventListener("pagehide", leave);
    return () => { unsubscribe(); clearInterval(saver); clearInterval(heartbeat); window.removeEventListener("pagehide", leave); };
  }, [value, sync]);
  return <><p className="save-status" role="status">{status}</p>
    <Conversation session={value.session} provider={value.provider} onReset={onReset} persistent /></>;
}

export default function Learn() {
  const [records, setRecords] = useState<Records>();
  const [runtime, setRuntime] = useState<Runtime>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { void fetch("/api/learning").then(async r => {
    if (!r.ok) throw new Error((await r.json()).error);
    setRecords(await r.json());
  }).catch(error => setStatus(messages[error.message] ?? "기록을 불러올 수 없습니다.")); }, []);
  useEffect(load, [load]);
  async function start() {
    setBusy(true); setStatus("");
    try {
      const result = await api({ action: "start", scenario: "correction" });
      const provider = new FakeProvider(result.demoScenario as Scenario);
      const session = new LearningSession(provider, undefined, undefined, { id: result.id, ...result.conversationSnapshot, maxBytes: 128 * 1024 });
      setRuntime({ session, provider, id: result.id, secret: result.secret, confirmedSaveSequenceNumber: result.confirmedSaveSequenceNumber });
      if (session.getSnapshot().phase === "ready") session.start();
    } catch (error) { setStatus(messages[(error as Error).message] ?? "학습을 시작할 수 없습니다."); }
    finally { setBusy(false); }
  }
  function download(date: string) {
    const text = records?.notes.filter(n => n.date === date).map(n => n.markdown).join("\n---\n") ?? "";
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${date}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="shell"><header className="site-header"><a className="brand" href="/">talkie.</a><a href="/account">내 계정</a></header>
    <p className="demo-notice">가짜 AI로 학습하며 확인된 대화를 로컬 서버에 저장합니다. 실제 AI·음성은 연결 전입니다.</p>
    <p role="status">{status}</p>
    {runtime ? <StoredConversation value={runtime} onSaved={load} onReset={() => { setRuntime(undefined); load(); }} />
      : records && <section className="card account-card"><p>{records.email}</p><button className="primary" disabled={busy} onClick={() => void start()}>학습 시작·이어서 하기</button></section>}
    {records && <section className="card account-card"><h2>내 학습 노트</h2>{[...new Set(records.notes.map(n => n.date))].map(date => <div key={date}><button className="secondary" onClick={() => download(date)}>{date} 노트 다운로드</button></div>)}
      {!records.notes.length && <p>저장된 노트가 없습니다.</p>}
      {records.sessions.some(s => s.status === "ended" && !["ready", "empty", "expired"].includes(s.noteStatus)) && <p>노트를 정리하고 있습니다.</p>}
    </section>}
  </main>;
}
