"use client";
import { useEffect, useRef, useState } from "react";
import { requestVoiceConnectionToken } from "../client/voice";
import { requestLearningAction, VoiceLearningStore, type StoredVoiceSession } from "../client/learning";
import { apiErrorMessages } from "../client/api-error-messages";
import { createBrowserCascadeProviders } from "../voice/cascade/browser-providers";
import type { CascadeSelection } from "../voice/cascade/selection";
import { createVoicePort } from "../voice/create-port";
import { VoicePlayback } from "../voice/playback";
import { BrowserAudio } from "../voice/browser-audio";
import type { VoicePort } from "../voice/port";
import { VoiceLearningRecords } from "../voice/learning";
import type { ConversationSnapshot } from "../learning/types";
import { updateVoiceTranscriptTurns, type VoiceTranscriptTurn } from "../voice/transcript";

export type VoiceRoute = "gemini-live" | "cascade";
export type VoicePhase = "idle" | "connecting" | "live" | "saving";

const voiceErrorMessages: Record<string, string> = {
  ...apiErrorMessages,
  VOICE_TEST_DISABLED: "서버의 음성 대화 설정을 확인해 주세요.",
  VOICE_KEY_REQUIRED: "서버에 선택한 음성 경로의 API 키가 필요합니다.",
  VOICE_TEST_WAIT: "연결을 너무 자주 시작했어요. 이전 시작 후 4분이 지나면 다시 시작할 수 있습니다.",
};
const STOP_CODES = ["LOGIN_REQUIRED", "CONNECTION_EXPIRED", "SESSION_CLOSED", "NOT_FOUND"];

type Persistence = { store: VoiceLearningStore; records: VoiceLearningRecords; action?: "pause" | "end"; busy: boolean; timer?: ReturnType<typeof setInterval> };
type VoiceRuntime = { port: VoicePort; audio: BrowserAudio; abort: AbortController; persistence?: Persistence; playback?: VoicePlayback; timer?: ReturnType<typeof setTimeout> };

/**
 * Saved voice learning: confirmed transcripts, corrections and retries are stored per account,
 * paused sessions resume from the last confirmed save, and ending produces an evidence-based note.
 */
export function useVoiceLearning({ onEnded }: { onEnded: (learningSessionId: string) => void }) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [transcript, setTranscript] = useState<VoiceTranscriptTurn[]>([]);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>();
  const [deadline, setDeadline] = useState<number>();
  const runtime = useRef<VoiceRuntime | undefined>(undefined);
  const persistence = useRef<Persistence | undefined>(undefined);
  const ended = useRef(onEnded);
  useEffect(() => { ended.current = onEnded; }, [onEnded]);

  async function sync(value: Persistence) {
    if (value.busy || persistence.current !== value) return;
    value.busy = true;
    const action = value.action;
    try {
      const current = value.records.getSnapshot();
      await value.store.sync(current, action);
      value.records.acknowledge(current);
      if (persistence.current !== value) return;
      setSaveMessage(action === "end" ? "저장과 노트 정리를 마쳤습니다." : "저장 완료");
      if (action) {
        clearInterval(value.timer); persistence.current = undefined; setPhase("idle");
        if (action === "end") ended.current(value.store.session.learningSessionId);
      }
    } catch (error) {
      if (persistence.current !== value) return;
      const code = error instanceof Error ? error.message : "";
      setSaveMessage(code === "NOTE_PENDING" ? "노트를 정리하고 있어요. 잠시 후 자동으로 다시 시도합니다."
        : voiceErrorMessages[code] ?? "저장 실패 · 이 화면을 유지하면 미저장 기록을 자동으로 다시 저장합니다.");
      if (STOP_CODES.includes(code)) {
        clearInterval(value.timer); persistence.current = undefined; setPhase("idle");
        stop();
      }
    } finally { value.busy = false; }
  }

  function stop(action: "pause" | "end" = "pause") {
    const current = runtime.current;
    runtime.current = undefined;
    if (!current) return;
    clearTimeout(current.timer); current.abort.abort(); current.playback?.close(); current.port.close(); current.audio.close();
    setDeadline(undefined);
    if (current.persistence && persistence.current === current.persistence) {
      current.persistence.action = action; setPhase("saving");
      void sync(current.persistence);
    } else setPhase("idle");
  }

  useEffect(() => {
    const leave = () => {
      const value = persistence.current;
      if (value && value.action !== "end") navigator.sendBeacon("/api/learn", new Blob([JSON.stringify({ action: "pause", learningSessionId: value.store.session.learningSessionId, learningConnectionToken: value.store.session.learningConnectionToken })], { type: "application/json" }));
      stop();
    };
    window.addEventListener("pagehide", leave);
    const visibility = () => { if (document.hidden && runtime.current) { stop(); setStatusMessage("화면을 벗어나 음성 연결을 멈췄어요. 이어서 할 수 있어요."); } };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", visibility);
      leave(); clearInterval(persistence.current?.timer); persistence.current = undefined;
    };
  }, []);

  async function start(route: VoiceRoute, cascadeSelection: CascadeSelection) {
    if (runtime.current || persistence.current) return;
    setTranscript([]); setSnapshot(undefined); setSaveMessage("");
    setPhase("connecting"); setStatusMessage("마이크와 음성 연결을 준비하고 있어요.");
    const audio = new BrowserAudio(), abort = new AbortController();
    const current: VoiceRuntime = { audio, abort, port: { connect: async () => {}, sendAudio: () => {}, close: () => {} } };
    runtime.current = current;
    try {
      await audio.open((pcm, rate) => current.port.sendAudio(pcm, rate));
      if (runtime.current !== current) return;
      const session: StoredVoiceSession = await requestLearningAction({ action: "start", scenario: "voice" });
      if (runtime.current !== current) {
        await requestLearningAction({ action: "pause", learningSessionId: session.learningSessionId, learningConnectionToken: session.learningConnectionToken }); return;
      }
      const value: Persistence = { store: new VoiceLearningStore(session), records: new VoiceLearningRecords(session.conversationSnapshot), busy: false };
      current.persistence = value; persistence.current = value;
      setSnapshot(value.records.getSnapshot());
      setTranscript(value.records.getSnapshot().turns.map(t => ({ turnId: t.turnId, role: t.role, text: t.text, delivery: "played" })));
      value.timer = setInterval(() => void sync(value), 5000);
      const data = route === "cascade" ? await (async () => {
        const response = await fetch("/api/voice/cascade", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
          body: JSON.stringify({ action: "credential", testOnly: true, selection: cascadeSelection, ...session }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
      })() : await requestVoiceConnectionToken(abort.signal, session);
      if (runtime.current !== current) return;
      current.playback = new VoicePlayback(audio, turnId => {
        if (runtime.current !== current) return;
        current.port.acknowledgePlayback?.(turnId);
        const event = { type: "played" as const, turnId };
        setTranscript(previous => updateVoiceTranscriptTurns(previous, event));
        value.records.apply(event); setSnapshot(value.records.getSnapshot());
      });
      current.port = createVoicePort(route === "cascade"
        ? { provider: "cascade", providers: createBrowserCascadeProviders(data.temporarySttKey, data.cascadeRequestToken, session), learning: true }
        : { provider: "gemini-live", credential: { voiceConnectionToken: data.voiceConnectionToken, learning: true } }, event => {
        if (runtime.current !== current) return;
        value.records.apply(event); setSnapshot(value.records.getSnapshot());
        if (event.type === "connected") { setPhase("live"); setStatusMessage("듣고 있어요 · 편하게 영어로 말해 보세요."); }
        if (event.type === "transcript" || event.type === "interrupted") setTranscript(previous => updateVoiceTranscriptTurns(previous, event));
        try { current.playback?.handle(event); } catch { stop(); setStatusMessage("재생이 지연되어 연결을 멈췄어요. 이어서 할 수 있어요."); }
        if (event.type === "error") { setStatusMessage(event.code === "billing" ? "Soniox 계정의 결제·크레딧 상태 때문에 전사를 시작하지 못했습니다." : "음성 연결에 실패했습니다. 키·무료 한도·네트워크 상태를 확인해 주세요."); stop(); }
        if (event.type === "closed") { setStatusMessage("음성 연결이 끊겼어요. 저장된 대화부터 이어서 할 수 있어요."); stop(); }
      });
      const seconds = Math.min(Number(data.testDurationSeconds) || 180, 180);
      setDeadline(Date.now() + seconds * 1000);
      current.timer = setTimeout(() => { stop(); setStatusMessage("이번 연결 시간이 끝났어요. 저장된 대화부터 이어서 할 수 있어요."); }, seconds * 1000);
      await current.port.connect(value.records.getSnapshot(), data.priorLearningContext);
    } catch (error) {
      if (runtime.current !== current) return;
      const code = error instanceof Error ? error.message : "";
      stop(); setStatusMessage(voiceErrorMessages[code] ?? "연결하지 못했습니다. 마이크 권한·키·무료 한도·네트워크 상태를 확인해 주세요.");
    }
  }

  return {
    phase, statusMessage, saveMessage, transcript, snapshot, deadline,
    start: (route: VoiceRoute, selection: CascadeSelection) => void start(route, selection),
    pause: () => { stop("pause"); setStatusMessage("대화를 잠시 멈췄어요. 저장된 대화부터 이어서 할 수 있어요."); },
    end: () => { stop("end"); setStatusMessage("대화를 마치고 노트를 정리하고 있어요."); },
  };
}
