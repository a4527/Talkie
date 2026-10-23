import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "./config";
import { DAY, dbNow, digest, token, withIdentity, type Identity } from "./auth";
import { databases, type Transaction } from "./db";
import { jobs, learningSessions, notes } from "./db/schema";
import { transcripts, transcriptVersions } from "./db/transcript-schema";
import type { Session, Correction } from "../learning/types";
import { koreaDate } from "../learning/note";

export type Snapshot = Pick<Session, "turns" | "corrections" | "learning"> & { gaps?: boolean };
export function snapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") throw new AppError("INVALID_RECORD");
  const value = input as Snapshot;
  if (!Array.isArray(value.turns) || !Array.isArray(value.corrections) || !["retry", "conversation"].includes(value.learning)) throw new AppError("INVALID_RECORD");
  if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024 || value.turns.length > 500) throw new AppError("RECORD_TOO_LARGE", 413);
  const ids = new Set<string>();
  const turns = value.turns.map(t => {
    if (!t || typeof t.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(t.id) || ids.has(t.id) || typeof t.requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(t.requestId) || !["user", "assistant"].includes(t.role) || typeof t.text !== "string" || t.text.length > 12_000) throw new AppError("INVALID_RECORD");
    ids.add(t.id);
    return { id: t.id, requestId: t.requestId, role: t.role, text: t.text };
  });
  const corrections = value.corrections.map((c: Correction) => {
    if (!c || typeof c.id !== "string" || c.id.length > 100 || typeof c.replacement !== "string" || c.replacement.length > 1200 || typeof c.explanation !== "string" || c.explanation.length > 2000 || !Array.isArray(c.attempts) || c.attempts.length > 500 ||
      !turns.some(t => t.id === c.sourceTurnId && t.role === "user") || !turns.some(t => t.id === c.deliveredTurnId && t.role === "assistant" && t.text.includes(c.replacement))) throw new AppError("INVALID_RECORD");
    const attempts = c.attempts.map((a: Correction["attempts"][number]) => {
      if (!a || !["success", "failure"].includes(a.outcome) || !turns.some(t => t.id === a.turnId && t.role === "user")) throw new AppError("INVALID_RECORD");
      return { turnId: a.turnId, outcome: a.outcome };
    });
    return { id: c.id, sourceTurnId: c.sourceTurnId, deliveredTurnId: c.deliveredTurnId, replacement: c.replacement, explanation: c.explanation, attempts };
  });
  return { turns, corrections, learning: value.learning, gaps: value.gaps === true };
}

type LearningRow = typeof learningSessions.$inferSelect;
async function owned(tx: Transaction, who: Identity, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("NOT_FOUND", 404);
  const [row] = await tx.select().from(learningSessions).where(and(eq(learningSessions.id, id), eq(learningSessions.userId, who.userId))).for("update");
  if (!row) throw new AppError("NOT_FOUND", 404);
  return row;
}
function connection(row: LearningRow, secret: string, now: Date, allowEnded = false) {
  if ((!allowEnded && row.endedAt) || !row.connectionHash || row.connectionHash !== digest(secret) ||
    (!(allowEnded && row.endedAt) && (!row.leaseUntil || row.leaseUntil <= now))) throw new AppError("CONNECTION_EXPIRED", 409);
}
async function readConfirmed(row: LearningRow): Promise<Snapshot> {
  const stored = await databases().temporary.select().from(transcriptVersions).where(and(eq(transcriptVersions.sessionId, row.id), sql`${transcriptVersions.version} <= ${row.version}`)).orderBy(asc(transcriptVersions.version));
  if (!stored.length || stored.at(-1)!.version !== row.version) throw new AppError("RECORD_UNAVAILABLE", 409);
  const turns = new Map<string, Session["turns"][number]>(), corrections = new Map<string, Correction>();
  let learning: Snapshot["learning"] = "conversation", gaps = false;
  for (const batch of stored) {
    const data = snapshot(batch.payload);
    for (const turn of data.turns) {
      const old = turns.get(turn.id);
      if (old && JSON.stringify(old) !== JSON.stringify(turn)) throw new AppError("VERSION_CONFLICT", 409);
      turns.set(turn.id, turn);
    }
    for (const correction of data.corrections) corrections.set(correction.id, correction);
    learning = data.learning; gaps ||= data.gaps === true;
  }
  return { turns: [...turns.values()], corrections: [...corrections.values()], learning, gaps };
}
export async function startLearning(raw: string | undefined, scenario: string) {
  return withIdentity(raw, async (tx, who) => {
    const now = await dbNow(tx);
    const [previous] = await tx.select().from(learningSessions).where(and(eq(learningSessions.userId, who.userId), inArray(learningSessions.status, ["active", "interrupted"]))).for("update");
    if (previous?.leaseUntil && previous.leaseUntil > now && previous.status === "active") throw new AppError("ALREADY_CONNECTED", 409);
    if (previous) {
      const interruptedAt = previous.interruptedAt ?? previous.leaseUntil ?? now;
      if (now.getTime() >= interruptedAt.getTime() + DAY) throw new AppError("SESSION_CLOSING", 409);
      const payload = await readConfirmed(previous);
      const secret = token();
      await tx.update(learningSessions).set({ status: "active", interruptedAt: null, connectionHash: digest(secret), leaseUntil: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.id, previous.id));
      return { id: previous.id, secret, version: previous.version, scenario: previous.scenario, snapshot: payload };
    }
    if (!["correction", "conversation"].includes(scenario)) throw new AppError("INVALID_SCENARIO");
    const id = randomUUID(), secret = token();
    const empty: Snapshot = { turns: [], corrections: [], learning: "conversation", gaps: false };
    await tx.insert(learningSessions).values({ id, userId: who.userId, createdAt: now, connectionHash: digest(secret), leaseUntil: new Date(now.getTime() + 45_000), scenario });
    await databases().temporary.insert(transcripts).values({ sessionId: id, userId: who.userId, version: 0, digest: digest(JSON.stringify(empty)), payload: empty });
    await databases().temporary.insert(transcriptVersions).values({ sessionId: id, version: 0, digest: digest(JSON.stringify(empty)), payload: empty });
    return { id, secret, version: 0, scenario, snapshot: empty };
  });
}

export async function heartbeat(raw: string | undefined, id: string, secret: string, pause = false) {
  return withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id), now = await dbNow(tx);
    connection(row, secret, now, true);
    if (row.noteStatus === "ready" || row.noteStatus === "empty" || (row.eraseAt && row.eraseAt <= now)) throw new AppError("SESSION_CLOSED", 409);
    if (row.endedAt) {
      await tx.update(learningSessions).set({ leaseUntil: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.id, id));
      return;
    }
    await tx.update(learningSessions).set(pause
      ? { status: "interrupted", interruptedAt: now, leaseUntil: now }
      : { leaseUntil: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.id, id));
  });
}

export async function saveLearning(raw: string | undefined, id: string, secret: string, version: number, input: unknown) {
  const data = snapshot(input), hash = digest(JSON.stringify(data));
  if (!Number.isSafeInteger(version) || version < 1) throw new AppError("INVALID_VERSION");
  return withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id), now = await dbNow(tx);
    connection(row, secret, now, true);
    if (row.noteStatus === "ready" || row.noteStatus === "empty" || (row.eraseAt && row.eraseAt <= now)) throw new AppError("SESSION_CLOSED", 409);
    if (version < row.version || version > row.version + 1) throw new AppError("VERSION_CONFLICT", 409);
    await databases().temporary.transaction(async temp => {
      const [stored] = await temp.select().from(transcripts).where(eq(transcripts.sessionId, id)).for("update");
      if (!stored || (stored.eraseAt && stored.eraseAt <= now)) throw new AppError("SESSION_CLOSED", 409);
      const history = await temp.select().from(transcriptVersions).where(and(eq(transcriptVersions.sessionId, id), sql`${transcriptVersions.version} <= ${row.version}`));
      const known = new Map<string, string>();
      for (const batch of history) for (const turn of snapshot(batch.payload).turns) known.set(turn.id, JSON.stringify(turn));
      if (data.turns.some(turn => known.has(turn.id) && known.get(turn.id) !== JSON.stringify(turn))) throw new AppError("VERSION_CONFLICT", 409);
      const [previous] = await temp.select().from(transcriptVersions).where(and(eq(transcriptVersions.sessionId, id), eq(transcriptVersions.version, version)));
      if (previous && previous.digest !== hash) throw new AppError("VERSION_CONFLICT", 409);
      if (version === row.version && !previous) throw new AppError("RECORD_UNAVAILABLE", 409);
      await temp.insert(transcriptVersions).values({ sessionId: id, version, digest: hash, payload: data }).onConflictDoNothing();
      await temp.update(transcripts).set({ eraseAt: row.eraseAt }).where(eq(transcripts.sessionId, id));
    });
    await tx.update(learningSessions).set({ version, leaseUntil: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.id, id));
    return { version };
  });
}

export async function endLearning(raw: string | undefined, id: string, secret: string) {
  return withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id), now = await dbNow(tx);
    if (row.endedAt) return { endedAt: row.endedAt.toISOString() };
    connection(row, secret, now);
    const eraseAt = new Date(now.getTime() + DAY);
    await tx.update(learningSessions).set({ status: "ended", endedAt: now, eraseAt, noteStatus: "waiting_save", leaseUntil: new Date(now.getTime() + 45_000) }).where(eq(learningSessions.id, id));
    await tx.insert(jobs).values({ userId: who.userId, sessionId: id, kind: "note", dueAt: new Date(now.getTime() + 60_000) });
    return { endedAt: now.toISOString() };
  });
}

// Deliberately small synthetic summary; actual AI selection is still B-09/B-06 work.
function demoMarkdown(data: Snapshot, endedAt: Date) {
  const users = data.turns.filter(t => t.role === "user");
  if (!users.length) return null;
  const escaped = (text: string) => text.slice(0, 160).replace(/[&<>\\`*_[\]{}()#!|]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? "\\" + c)).replace(/\r?\n/g, "\n> ");
  return `# ${koreaDate(endedAt.toISOString())} 영어 학습 노트\n\n가짜 AI 저장 시험 · 실제 언어 평가 결과가 아닙니다.\n\n${data.gaps ? "일부 대화 기록이 누락됐습니다.\n\n" : ""}## 대화 근거 일부\n\n` + users.slice(-3).map(t => `> ${escaped(t.text)}\n\n근거: ${t.id}`).join("\n\n") + "\n";
}
export async function finalize(tx: Transaction, row: LearningRow) {
  if (!row.endedAt || !row.eraseAt) return;
  const now = await dbNow(tx);
  if (["ready", "empty", "expired"].includes(row.noteStatus)) {
    await databases().temporary.delete(transcripts).where(eq(transcripts.sessionId, row.id));
    return;
  }
  if (row.eraseAt <= now) {
    await databases().temporary.delete(transcripts).where(eq(transcripts.sessionId, row.id));
    await tx.update(learningSessions).set({ noteStatus: "expired", connectionHash: null }).where(eq(learningSessions.id, row.id));
    return;
  }
  const data = await readConfirmed(row);
  const markdown = demoMarkdown(data, row.endedAt);
  if (markdown) await tx.insert(notes).values({ sessionId: row.id, userId: row.userId, date: koreaDate(row.endedAt.toISOString()), markdown,
    expiresAt: new Date(row.endedAt.getTime() + 30 * DAY) }).onConflictDoNothing();
  await tx.update(learningSessions).set({ noteStatus: markdown ? "ready" : "empty", connectionHash: null }).where(eq(learningSessions.id, row.id));
  // Commit durable note first. The worker deletes the source in a subsequent transaction.
}
export async function finishNote(raw: string | undefined, id: string) {
  await withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id);
    await finalize(tx, row);
  });
  await withIdentity(raw, async (tx, who) => {
    const row = await owned(tx, who, id);
    if (["ready", "empty", "expired"].includes(row.noteStatus)) await databases().temporary.delete(transcripts).where(eq(transcripts.sessionId, id));
  });
}
export async function listRecords(raw: string | undefined) {
  return withIdentity(raw, async (tx, who) => {
    const now = await dbNow(tx);
    const sessions = await tx.select({ id: learningSessions.id, status: learningSessions.status, noteStatus: learningSessions.noteStatus, endedAt: learningSessions.endedAt })
      .from(learningSessions).where(eq(learningSessions.userId, who.userId));
    const saved = await tx.select().from(notes).where(and(eq(notes.userId, who.userId), sql`${notes.expiresAt} > ${now}`));
    return { email: who.email, sessions, notes: saved.map(n => ({ date: n.date, markdown: n.markdown })) };
  });
}
