"use client";
import { useEffect, useRef, useState } from "react";
import { requestVoiceConnectionToken } from "../../client/voice";
import { GeminiLiveAdapter } from "../../voice/adapters/gemini-live";
import { BrowserAudio } from "../../voice/browser-audio";
import type { VoicePort } from "../../voice/port";
import { updateVoiceTranscriptTurns, type VoiceTranscriptTurn } from "../../voice/transcript";

const voiceErrorMessages: Record<string, string> = {
  LOGIN_REQUIRED: "먼저 내 계정에서 로컬 테스트 계정으로 로그인해 주세요.",
  VOICE_TEST_DISABLED: "서버의 무료 음성 시험 설정을 확인해 주세요.",
  VOICE_KEY_REQUIRED: "서버에 Google API 키가 필요합니다.",
  VOICE_TEST_WAIT: "이전 시험의 연결 자격이 만료된 뒤 다시 시작할 수 있습니다. 최대 4분 기다려 주세요.",
};
type VoiceRuntime = { port: VoicePort; audio: BrowserAudio; abort: AbortController; timer?: ReturnType<typeof setTimeout> };
export default function VoiceTest() {
  const [hasAcceptedVoiceTestConditions, setHasAcceptedVoiceTestConditions] = useState(false);
  const [active, setActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState("시작하면 마이크 권한을 요청합니다. 이어폰 사용을 권장합니다.");
  const [records, setRecords] = useState<VoiceTranscriptTurn[]>([]);
  const runtime = useRef<VoiceRuntime | undefined>(undefined);
  function stop() {
    const current = runtime.current;
    runtime.current = undefined;
    if (!current) return;
    clearTimeout(current.timer); current.abort.abort(); current.port.close(); current.audio.close();
    setActive(false);
  }
  useEffect(() => {
    const leave = () => stop();
    window.addEventListener("pagehide", leave);
    const visibility = () => { if (document.hidden) { stop(); setStatusMessage("화면을 벗어나 음성 시험을 종료했습니다."); } };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", visibility); stop(); };
  }, []);
  async function start() {
    if (runtime.current || !hasAcceptedVoiceTestConditions) return;
    setRecords([]); setActive(true); setStatusMessage("마이크와 음성 연결을 준비하고 있습니다.");
    const audio = new BrowserAudio(), abort = new AbortController();
    // Install runtime before any await so end/unmount also cancels pending permission/token requests.
    const current: VoiceRuntime = { audio, abort, port: { connect: async () => {}, sendAudio: () => {}, close: () => {} } };
    runtime.current = current;
    try {
      await audio.open((pcm, rate) => current.port.sendAudio(pcm, rate));
      if (runtime.current !== current) return;
      const data = await requestVoiceConnectionToken(abort.signal);
      if (runtime.current !== current) return;
      const hasAudio = new Set<string>();
      current.port = new GeminiLiveAdapter({ voiceConnectionToken: data.voiceConnectionToken }, event => {
        if (runtime.current !== current) return;
        if (event.type === "connected") setStatusMessage("대화 중 · 가상의 일상 이야기로 영어 한 문장을 말해 보세요. 최대 3분 후 종료합니다.");
        if (event.type === "transcript" || event.type === "interrupted") setRecords(previous => updateVoiceTranscriptTurns(previous, event));
        if (event.type === "audio") {
          hasAudio.add(event.turnId);
          try { audio.play(event.pcm, event.sampleRateHz); } catch { stop(); setStatusMessage("재생이 지연되어 시험을 종료했습니다."); }
        }
        if (event.type === "interrupted") { audio.interrupt(); hasAudio.delete(event.turnId); }
        if (event.type === "response-complete" && hasAudio.delete(event.turnId)) {
          void audio.drained().then(played => {
            if (played && runtime.current === current) setRecords(previous => updateVoiceTranscriptTurns(previous, { type: "played", turnId: event.turnId }));
          });
        }
        if (event.type === "error") { setStatusMessage("음성 연결에 실패했습니다. 키·무료 한도·네트워크 상태를 확인해 주세요."); stop(); }
        if (event.type === "closed") { setStatusMessage("음성 연결이 종료되었습니다."); stop(); }
      });
      current.timer = setTimeout(() => { stop(); setStatusMessage("3분 시험을 마쳤습니다."); }, Math.min(Number(data.testDurationSeconds) || 180, 180) * 1000);
      await current.port.connect();
    } catch (error) {
      if (runtime.current !== current) return;
      const code = error instanceof Error ? error.message : "";
      stop(); setStatusMessage(voiceErrorMessages[code] ?? "연결하지 못했습니다. 마이크 권한·키·무료 한도·네트워크 상태를 확인해 주세요.");
    }
  }
  return <main className="shell">
    <header className="site-header"><a className="brand" href="/">talkie.</a><a href="/account">내 계정</a></header>
    <section className="card account-card">
      <h1>음성 대화 시험</h1>
      <p>개발자 본인만 사용하는 비공개 시험입니다. Google이 음성과 대화를 제품 개선·학습에 사용하거나 사람이 검토할 수 있습니다. 개인정보·민감정보·기밀정보는 말하지 마세요.</p>
      <p>대화 표시는 현재 화면의 메모리에만 남습니다. 기록 저장·재개·학습 노트는 아직 연결하지 않았습니다.</p>
      <label><input type="checkbox" checked={hasAcceptedVoiceTestConditions} disabled={active} onChange={event => setHasAcceptedVoiceTestConditions(event.target.checked)} /> 본인 음성·가상 대화로 시험하며 공급자의 학습 사용 조건을 확인했습니다.</label>
      <p role="status">{statusMessage}</p>
      <div className="session-actions"><button className="primary" disabled={!hasAcceptedVoiceTestConditions || active} onClick={() => void start()}>음성 시험 시작</button>
        <button className="secondary" disabled={!active} onClick={() => { stop(); setStatusMessage("음성 시험을 종료했습니다."); }}>시험 종료</button></div>
      <p><a href="/learn">저장 기능이 있는 텍스트 데모</a></p>
    </section>
    <section className="card account-card" aria-label="음성 전사문">
      <h2>대화</h2><p>AI 전사문은 생성 결과입니다. 재생 완료 표시는 기기의 재생 완료 신호이며 실제 청취·학습 성공을 뜻하지 않습니다. 중단 응답은 전체를 근거에서 제외합니다.</p>
      <div role="log" aria-live="polite">{records.map(record => <div className={`turn ${record.role}`} key={record.turnId}>
        <span className="speaker">{record.role === "user" ? "나 · 전사" : `Talkie · ${record.delivery === "played" ? "재생 완료" : record.delivery === "interrupted" ? "중단 · 근거 제외" : "재생 미확인"}`}</span><p>{record.text}</p>
      </div>)}</div>
    </section>
  </main>;
}
