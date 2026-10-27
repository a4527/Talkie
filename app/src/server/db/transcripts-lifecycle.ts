import "server-only";
import { eq, sql } from "drizzle-orm";
import { databases } from "./index";
import { transcriptSessionStates, transcriptSaves } from "./transcripts-schema";

export type TranscriptDeletionReason = "note_saved" | "no_user_turns" | "deadline_expired";

// Save and delete lock the same state row. The tombstone survives normal source
// deletion and blocks late writes; the content and completion commit atomically.
export async function deleteTranscriptSource(learningSessionId: string, reason: TranscriptDeletionReason) {
  await databases().transcripts.transaction(async tx => {
    const [state] = await tx.select().from(transcriptSessionStates)
      .where(eq(transcriptSessionStates.learningSessionId, learningSessionId)).for("update");
    if (!state || state.sourceDeletedAt) return;
    const removed = await tx.delete(transcriptSaves).where(eq(transcriptSaves.learningSessionId, learningSessionId))
      .returning({ sequence: transcriptSaves.saveSequenceNumber });
    // A missing source is not proof of a deletion performed by this transaction.
    if (!removed.length) return;
    await tx.update(transcriptSessionStates).set({ sourceDeletedAt: sql`clock_timestamp()`, sourceDeletionReason: reason })
      .where(eq(transcriptSessionStates.learningSessionId, learningSessionId));
  });
}

export function transcriptDeletionReason(noteGenerationStatus: string): TranscriptDeletionReason {
  if (noteGenerationStatus === "ready") return "note_saved";
  if (noteGenerationStatus === "empty") return "no_user_turns";
  if (noteGenerationStatus === "expired") return "deadline_expired";
  throw new Error("TRANSCRIPT_NOT_FINALIZED");
}
