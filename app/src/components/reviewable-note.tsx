"use client";
import { useState } from "react";
import { requestLearningAction } from "../client/learning";
import { errorMessage } from "../client/app";
import { NoteView } from "./note-view";

/**
 * A stored note with per-item review choices (DEC-098). The note text never changes; turning an item off
 * only keeps it out of later review suggestions and the expression list.
 */
export function ReviewableNote({ note, idPrefix, onChanged }: { note: { learningSessionId: string; noteMarkdown: string; excludedReviewItems: number[] }; idPrefix: string; onChanged: () => Promise<void> | void }) {
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  // Shown at once; dropped when the reloaded note agrees, restored to the stored value on failure.
  const [optimistic, setOptimistic] = useState<Map<number, boolean>>(new Map());
  const stored = note.excludedReviewItems ?? [];
  const excluded = [...new Set([...stored.filter(n => optimistic.get(n) !== true), ...[...optimistic].filter(([, on]) => !on).map(([n]) => n)])];
  async function change(reviewItem: number, included: boolean) {
    setPending(reviewItem); setMessage("");
    setOptimistic(m => new Map(m).set(reviewItem, included));
    try { await requestLearningAction({ action: "review", learningSessionId: note.learningSessionId, reviewItem, included }); await onChanged(); }
    catch (error) { setMessage(errorMessage(error, "복습 선택을 저장하지 못했어요. 다시 시도해 주세요.")); }
    finally { setOptimistic(m => { const next = new Map(m); next.delete(reviewItem); return next; }); setPending(null); }
  }
  return <>
    {message && <p role="status" className="form-status">{message}</p>}
    <NoteView markdown={note.noteMarkdown} idPrefix={idPrefix} review={{ excluded, pending, onChange: (n, on) => void change(n, on) }} />
  </>;
}
