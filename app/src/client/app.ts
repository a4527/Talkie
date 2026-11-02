"use client";
import { useCallback, useEffect, useState } from "react";
import type { LearningRecordsResponse } from "../learning/types";
import { apiErrorMessages } from "./api-error-messages";

export type AccountInfo = { emailAddress: string; google: { googleEmailAddress: string } | null; emailLoginAvailable: boolean; googleLoginAvailable: boolean };
export type LoadState<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; message: string };

export function errorMessage(error: unknown, fallback: string) {
  return apiErrorMessages[error instanceof Error ? error.message : ""] ?? fallback;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}

/** Loads a signed-in resource; an expired or missing login goes to the login page. */
export function useSignedIn<T>(path: string) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const reload = useCallback(async () => {
    try { setState({ status: "ready", value: await getJson<T>(path) }); }
    catch (error) {
      if (error instanceof Error && error.message === "LOGIN_REQUIRED") { window.location.replace("/login"); return; }
      setState({ status: "error", message: errorMessage(error, "정보를 불러올 수 없습니다.") });
    }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return [state, reload] as const;
}
export const useRecords = () => useSignedIn<LearningRecordsResponse>("/api/learn");
export const useAccount = () => useSignedIn<AccountInfo>("/api/account");

/** Returns the signed-in email, or null when signed out, without redirecting. */
export function useOptionalAccount() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => { void getJson<AccountInfo>("/api/account").then(v => setEmail(v.emailAddress), () => setEmail(null)); }, []);
  return email;
}

export function downloadMarkdown(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function notesByDate(notes: LearningRecordsResponse["notes"]) {
  const days = new Map<string, LearningRecordsResponse["notes"]>();
  for (const note of notes) days.set(note.learningEndDateKst, [...(days.get(note.learningEndDateKst) ?? []), note]);
  return [...days.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export function formatKoreanDate(dateKst: string) {
  const [y, m, d] = dateKst.split("-").map(Number);
  const weekday = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${weekday})`;
}

/** First meaningful line of a note body, for list previews. */
export function notePreview(markdown: string) {
  const line = markdown.split("\n").map(l => l.trim()).find(l => l.startsWith("내용:")) ?? "";
  return unescapeNoteText(line.replace(/^내용:\s*/, "")).slice(0, 90);
}

export function unescapeNoteText(value: string) {
  return value.replace(/\\(.)/g, "$1").replace(/&#10;/g, "\n").replace(/&#13;/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
export const modeLabel = (scenario: string) => scenario === "voice" ? "음성 대화" : "텍스트 연습";
