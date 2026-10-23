import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { AppError, config, emailKey } from "./config";
import { databases, type Transaction } from "./db";
import { authSessions, challenges, controls, deletionConfirmations, jobs, users } from "./db/schema";

export const DAY = 86_400_000;
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function checkedToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AppError("INVALID_LINK");
  return value;
}
export async function dbNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(result.rows[0].now);
}
export type Identity = { userId: string; email: string; sessionId: string; expiresAt: Date };
export async function identity(tx: Transaction, raw: string | undefined, renew = true): Promise<Identity> {
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AppError("LOGIN_REQUIRED", 401);
  const [hint] = await tx.select().from(authSessions).where(eq(authSessions.tokenHash, digest(raw)));
  if (!hint) throw new AppError("LOGIN_REQUIRED", 401);
  const [user] = await tx.select().from(users).where(eq(users.id, hint.userId)).for("update");
  const [session] = await tx.select().from(authSessions).where(eq(authSessions.id, hint.id)).for("update");
  const now = await dbNow(tx);
  if (!user || user.deletedAt || !session || session.revokedAt || session.expiresAt <= now) throw new AppError("LOGIN_REQUIRED", 401);
  const expiresAt = renew ? new Date(now.getTime() + 30 * DAY) : session.expiresAt;
  if (renew) await tx.update(authSessions).set({ lastSeenAt: now, expiresAt }).where(eq(authSessions.id, session.id));
  return { userId: user.id, email: user.email, sessionId: session.id, expiresAt };
}
export async function withIdentity<T>(raw: string | undefined, work: (tx: Transaction, who: Identity) => Promise<T>) {
  return databases().records.transaction(async tx => work(tx, await identity(tx, raw)));
}

export type Mail = { to: string; url: string; purpose: string };
export async function sendLocalMail(mail: Mail) {
  const cfg = config();
  emailKey(mail.to);
  const transport = nodemailer.createTransport({ host: cfg.smtpHost, port: cfg.smtpPort, secure: false,
    connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000, logger: false, debug: false, ignoreTLS: true });
  try {
    await transport.sendMail({ from: "Talkie <login@talkie.test>", to: mail.to,
      subject: mail.purpose === "login" ? "Talkie 로그인 확인" : "Talkie 탈퇴 본인 확인",
      text: `직접 요청한 경우에만 아래 주소에서 대상 이메일을 확인하고 버튼을 누르세요. 링크는 발급 후 10분간 한 번만 사용할 수 있습니다.\n\n${mail.url}` });
  } finally { transport.close(); }
}

export async function requestLink(input: unknown, purpose: "login" | "delete", rawSession?: string,
  send: (mail: Mail) => Promise<void> = sendLocalMail) {
  const email = emailKey(input);
  const raw = token();
  const request = await databases().records.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
    const now = await dbNow(tx);
    const [control] = await tx.select().from(controls).where(eq(controls.email, email));
    if (control && now.getTime() - control.requestedAt.getTime() < 30_000) throw new AppError("WAIT_30_SECONDS", 429);
    let sessionId: string | null = null;
    if (purpose === "delete") {
      const who = await identity(tx, rawSession);
      if (who.email !== email) throw new AppError("LOGIN_REQUIRED", 401);
      sessionId = who.sessionId;
    }
    const [user] = await tx.select().from(users).where(eq(users.email, email)).for("update");
    await tx.insert(controls).values({ email, requestedAt: now }).onConflictDoUpdate({ target: controls.email, set: { requestedAt: now } });
    await tx.update(challenges).set({ revokedAt: now }).where(and(eq(challenges.email, email), eq(challenges.purpose, purpose), isNull(challenges.revokedAt), isNull(challenges.consumedAt)));
    if (user?.deletedAt) return undefined; // Same public request response; no account enumeration.
    const [challenge] = await tx.insert(challenges).values({ email, purpose, sessionId,
      tokenHash: digest(raw), createdAt: now, expiresAt: new Date(now.getTime() + 600_000) }).returning();
    return challenge;
  });
  if (!request) return;
  let delivery = "accepted";
  try {
    await send({ to: email, purpose, url: `${config().origin}/account/confirm#${raw}` });
  } catch { delivery = "failed_or_unknown"; }
  // SMTP and SQL are separate: never retry mail or pretend SMTP acceptance means inbox arrival.
  await databases().records.update(challenges).set({ delivery }).where(eq(challenges.id, request.id));
}

async function validChallenge(tx: Transaction, raw: string) {
  const [hint] = await tx.select().from(challenges).where(eq(challenges.tokenHash, digest(checkedToken(raw))));
  if (!hint) throw new AppError("INVALID_LINK");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hint.email}, 0))`);
  const [row] = await tx.select().from(challenges).where(eq(challenges.id, hint.id)).for("update");
  const now = await dbNow(tx);
  if (!row || row.revokedAt) throw new AppError("REPLACED_LINK");
  if (row.consumedAt) throw new AppError("USED_LINK");
  if (row.expiresAt <= now) throw new AppError("EXPIRED_LINK");
  return { row, now };
}
export async function inspectLink(raw: string) {
  return databases().records.transaction(async tx => {
    const { row } = await validChallenge(tx, raw);
    return { email: row.email, purpose: row.purpose };
  });
}
export async function consumeLink(raw: string, currentSession?: string) {
  return databases().records.transaction(async tx => {
    const { row } = await validChallenge(tx, raw);
    if (row.purpose === "delete") {
      const who = await identity(tx, currentSession);
      const now = await dbNow(tx);
      if (row.expiresAt <= now) throw new AppError("EXPIRED_LINK");
      if (who.sessionId !== row.sessionId || who.email !== row.email) throw new AppError("ORIGINAL_BROWSER_REQUIRED", 403);
      await tx.update(challenges).set({ consumedAt: now }).where(eq(challenges.id, row.id));
      await tx.insert(deletionConfirmations).values({ sessionId: who.sessionId, expiresAt: new Date(now.getTime() + 600_000) })
        .onConflictDoUpdate({ target: deletionConfirmations.sessionId, set: { expiresAt: new Date(now.getTime() + 600_000), consumedAt: null } });
      return { purpose: "delete" as const };
    }
    if (currentSession) {
      try {
        const existing = await identity(tx, currentSession, false);
        if (existing.email !== row.email) throw new AppError("LOGOUT_FIRST", 409);
      } catch (error) { if (!(error instanceof AppError) || error.code !== "LOGIN_REQUIRED") throw error; }
    }
    await tx.insert(users).values({ email: row.email }).onConflictDoNothing({ target: users.email });
    const [user] = await tx.select().from(users).where(eq(users.email, row.email)).for("update");
    if (!user || user.deletedAt) throw new AppError("INVALID_LINK");
    const now = await dbNow(tx);
    if (row.expiresAt <= now) throw new AppError("EXPIRED_LINK");
    const secret = token();
    const expiresAt = new Date(now.getTime() + 30 * DAY);
    await tx.insert(authSessions).values({ userId: user.id, tokenHash: digest(secret), createdAt: now, lastSeenAt: now, expiresAt });
    await tx.update(challenges).set({ consumedAt: now }).where(eq(challenges.id, row.id));
    return { purpose: "login" as const, secret, expiresAt };
  });
}
export async function logout(raw: string | undefined) {
  if (!raw) return;
  await databases().records.transaction(async tx => {
    try {
      const who = await identity(tx, raw, false);
      await tx.update(authSessions).set({ revokedAt: await dbNow(tx) }).where(eq(authSessions.id, who.sessionId));
    } catch (error) { if (!(error instanceof AppError) || error.code !== "LOGIN_REQUIRED") throw error; }
  });
}
export async function deleteAccount(raw: string | undefined) {
  return withIdentity(raw, async (tx, who) => {
    const [proof] = await tx.select().from(deletionConfirmations).where(eq(deletionConfirmations.sessionId, who.sessionId)).for("update");
    const now = await dbNow(tx);
    if (!proof || proof.consumedAt || proof.expiresAt <= now) throw new AppError("CONFIRM_DELETE_FIRST", 403);
    await tx.update(deletionConfirmations).set({ consumedAt: now }).where(eq(deletionConfirmations.sessionId, who.sessionId));
    await tx.update(users).set({ deletedAt: now }).where(eq(users.id, who.userId));
    await tx.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.userId, who.userId));
    await tx.update(challenges).set({ revokedAt: now }).where(eq(challenges.email, who.email));
    await tx.insert(jobs).values({ userId: who.userId, kind: "delete_account", dueAt: now });
  });
}
