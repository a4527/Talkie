"use client";
import { apiErrorMessages } from "../client/api-error-messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "./conversation";
import { requestLearningAction } from "../client/learning";
import type { FakeProvider } from "../learning/fake-provider";
import type { LearningSession } from "../learning/session";
import type { LearningSessionState, ConversationSnapshot } from "../learning/types";

/** Text practice with the scripted fake tutor, saved to the account like voice learning. */
export type LearningRuntime = { session: LearningSession; provider: FakeProvider; learningSessionId: string; learningConnectionToken: string; confirmedSaveSequenceNumber: number };

export function StoredTextConversation({ value, onReset, onSaved }: { value: LearningRuntime; onReset: () => void; onSaved: () => void }) {
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

