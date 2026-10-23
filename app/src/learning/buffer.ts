import type { Correction, Turn } from "./types";

// Bound the serialized confirmed window; remove whole request groups, never half a turn/state pair.
export function boundRecords(turns: readonly Turn[], corrections: readonly Correction[], maxBytes: number) {
  let kept = [...turns], selected = [...corrections], dropped = false;
  const removed: string[] = [];
  const bytes = () => new TextEncoder().encode(JSON.stringify({ turns: kept, corrections: selected })).length;
  while (kept.length && (kept.length > 200 || bytes() > maxBytes)) {
    const requestId = kept[0].requestId;
    removed.push(requestId);
    kept = kept.filter(t => t.requestId !== requestId);
    const ids = new Set(kept.map(t => t.id));
    // If any evidence of a correction unit is removed, discard that entire unit.
    selected = selected.filter(c => ids.has(c.sourceTurnId) && ids.has(c.deliveredTurnId) && c.attempts.every(a => ids.has(a.turnId)));
    dropped = true;
  }
  return { turns: kept, corrections: selected, dropped, removed };
}
