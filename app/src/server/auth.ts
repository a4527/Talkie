import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { AppError, getLocalConfig, normalizeTestEmailAddress } from "./config";
import { databases, type RecordsTransaction } from "./db";
import { loginSessions, emailAuthRequests, emailAuthRateLimits, scheduledJobs, users } from "./db/records-schema";

export const DAY = 86_400_000;
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function checkedToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AppError("INVALID_LINK");
  return value;
}
export async function dbNow(tx: RecordsTransaction): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(result.rows[0].now);
}
export type Identity = { userId: string; emailAddress: string; loginSessionId: string; expiresAt: Date };
export async function identity(tx: RecordsTransaction, loginSessionToken: string | undefined, renew = true): Promise<Identity> {
  if (!loginSessionToken || !/^[A-Za-z0-9_-]{43}$/.test(loginSessionToken)) throw new AppError("LOGIN_REQUIRED", 401);
  const [hint] = await tx.select().from(loginSessions).where(eq(loginSessions.loginTokenHash, digest(loginSessionToken)));
  if (!hint) throw new AppError("LOGIN_REQUIRED", 401);
  const [user] = await tx.select().from(users).where(eq(users.userId, hint.userId)).for("update");
  const [session] = await tx.select().from(loginSessions).where(eq(loginSessions.loginSessionId, hint.loginSessionId)).for("update");
  const now = await dbNow(tx);
  if (!user || user.accountDeletionConfirmedAt || !session || session.loginSessionInvalidatedAt || session.loginSessionExpiresAt <= now) throw new AppError("LOGIN_REQUIRED", 401);
  const expiresAt = renew ? new Date(now.getTime() + 30 * DAY) : session.loginSessionExpiresAt;
  if (renew) await tx.update(loginSessions).set({ lastAuthenticatedActivityAt: now, loginSessionExpiresAt: expiresAt }).where(eq(loginSessions.loginSessionId, session.loginSessionId));
  return { userId: user.userId, emailAddress: user.emailAddress, loginSessionId: session.loginSessionId, expiresAt };
}
export async function withIdentity<T>(loginSessionToken: string | undefined, work: (tx: RecordsTransaction, who: Identity) => Promise<T>) {
  return databases().records.transaction(async tx => work(tx, await identity(tx, loginSessionToken)));
}

export type AuthenticationPurpose = "login" | "account_deletion";
export type Mail = { to: string; url: string; purpose: AuthenticationPurpose };
export async function sendLocalMail(mail: Mail) {
  const cfg = getLocalConfig();
  normalizeTestEmailAddress(mail.to);
  const transport = nodemailer.createTransport({ host: cfg.smtpHost, port: cfg.smtpPort, secure: false,
    connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000, logger: false, debug: false, ignoreTLS: true });
  try {
    await transport.sendMail({ from: "Talkie <login@talkie.test>", to: mail.to,
      subject: mail.purpose === "login" ? "Talkie 로그인 확인" : "Talkie 탈퇴 본인 확인",
      text: `직접 요청한 경우에만 아래 주소에서 대상 이메일을 확인하고 버튼을 누르세요. 링크는 발급 후 10분간 한 번만 사용할 수 있습니다.\n\n${mail.url}` });
  } finally { transport.close(); }
}

export async function requestLink(input: unknown, purpose: AuthenticationPurpose, loginSessionToken?: string,
  send: (mail: Mail) => Promise<void> = sendLocalMail) {
  const email = normalizeTestEmailAddress(input), authLinkToken = token();
  const request = await databases().records.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
    const now = await dbNow(tx);
    const [control] = await tx.select().from(emailAuthRateLimits).where(eq(emailAuthRateLimits.emailAddress, email));
    if (control && now.getTime() - control.lastAuthEmailRequestedAt.getTime() < 30_000) throw new AppError("WAIT_30_SECONDS", 429);
    let requestingLoginSessionId: string | null = null;
    if (purpose === "account_deletion") {
      const who = await identity(tx, loginSessionToken);
      if (who.emailAddress !== email) throw new AppError("LOGIN_REQUIRED", 401);
      requestingLoginSessionId = who.loginSessionId;
    }
    const [user] = await tx.select().from(users).where(eq(users.emailAddress, email)).for("update");
    await tx.insert(emailAuthRateLimits).values({ emailAddress: email, lastAuthEmailRequestedAt: now })
      .onConflictDoUpdate({ target: emailAuthRateLimits.emailAddress, set: { lastAuthEmailRequestedAt: now } });
    await tx.update(emailAuthRequests).set({ authLinkInvalidatedAt: now }).where(and(eq(emailAuthRequests.emailAddress, email), eq(emailAuthRequests.authenticationPurpose, purpose), isNull(emailAuthRequests.authLinkInvalidatedAt), isNull(emailAuthRequests.authLinkUsedAt)));
    if (user?.accountDeletionConfirmedAt) return undefined;
    const [request] = await tx.insert(emailAuthRequests).values({ emailAddress: email, authenticationPurpose: purpose, requestingLoginSessionId,
      authLinkTokenHash: digest(authLinkToken), authLinkIssuedAt: now, authLinkExpiresAt: new Date(now.getTime() + 600_000) }).returning();
    return request;
  });
  if (!request) return;
  let emailSendStatus = "smtp_accepted";
  try { await send({ to: email, purpose, url: `${getLocalConfig().origin}/account/confirm#${authLinkToken}` }); }
  catch { emailSendStatus = "failed_or_unknown"; }
  // SMTP and SQL are separate. This is not inbox delivery evidence; never retry mail here.
  await databases().records.update(emailAuthRequests).set({ emailSendStatus }).where(eq(emailAuthRequests.emailAuthRequestId, request.emailAuthRequestId));
}

async function validEmailAuthRequest(tx: RecordsTransaction, authLinkToken: string) {
  const [hint] = await tx.select().from(emailAuthRequests).where(eq(emailAuthRequests.authLinkTokenHash, digest(checkedToken(authLinkToken))));
  if (!hint) throw new AppError("INVALID_LINK");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hint.emailAddress}, 0))`);
  const [row] = await tx.select().from(emailAuthRequests).where(eq(emailAuthRequests.emailAuthRequestId, hint.emailAuthRequestId)).for("update");
  const now = await dbNow(tx);
  if (!row || row.authLinkInvalidatedAt) throw new AppError("REPLACED_LINK");
  if (row.authLinkUsedAt) throw new AppError("USED_LINK");
  if (row.authLinkExpiresAt <= now) throw new AppError("EXPIRED_LINK");
  return { row, now };
}
export async function inspectLink(authLinkToken: string) {
  return databases().records.transaction(async tx => {
    const { row } = await validEmailAuthRequest(tx, authLinkToken);
    return { emailAddress: row.emailAddress, purpose: row.authenticationPurpose };
  });
}
export async function consumeLink(authLinkToken: string, currentLoginSessionToken?: string) {
  return databases().records.transaction(async tx => {
    const { row } = await validEmailAuthRequest(tx, authLinkToken);
    if (row.authenticationPurpose === "account_deletion") {
      const who = await identity(tx, currentLoginSessionToken), now = await dbNow(tx);
      if (row.authLinkExpiresAt <= now) throw new AppError("EXPIRED_LINK");
      if (who.loginSessionId !== row.requestingLoginSessionId || who.emailAddress !== row.emailAddress) throw new AppError("ORIGINAL_BROWSER_REQUIRED", 403);
      await tx.update(emailAuthRequests).set({ authLinkUsedAt: now }).where(eq(emailAuthRequests.emailAuthRequestId, row.emailAuthRequestId));
      await tx.update(loginSessions).set({ accountDeletionAuthorizationExpiresAt: new Date(now.getTime() + 600_000), accountDeletionAuthorizationUsedAt: null })
        .where(eq(loginSessions.loginSessionId, who.loginSessionId));
      return { purpose: "account_deletion" as const };
    }
    if (currentLoginSessionToken) {
      try {
        const existing = await identity(tx, currentLoginSessionToken, false);
        if (existing.emailAddress !== row.emailAddress) throw new AppError("LOGOUT_FIRST", 409);
      } catch (error) { if (!(error instanceof AppError) || error.code !== "LOGIN_REQUIRED") throw error; }
    }
    await tx.insert(users).values({ emailAddress: row.emailAddress }).onConflictDoNothing({ target: users.emailAddress });
    const [user] = await tx.select().from(users).where(eq(users.emailAddress, row.emailAddress)).for("update");
    if (!user || user.accountDeletionConfirmedAt) throw new AppError("INVALID_LINK");
    const now = await dbNow(tx);
    if (row.authLinkExpiresAt <= now) throw new AppError("EXPIRED_LINK");
    const loginSessionToken = token(), expiresAt = new Date(now.getTime() + 30 * DAY);
    await tx.insert(loginSessions).values({ userId: user.userId, loginTokenHash: digest(loginSessionToken), loginSessionCreatedAt: now, lastAuthenticatedActivityAt: now, loginSessionExpiresAt: expiresAt });
    await tx.update(emailAuthRequests).set({ authLinkUsedAt: now }).where(eq(emailAuthRequests.emailAuthRequestId, row.emailAuthRequestId));
    return { purpose: "login" as const, loginSessionToken, expiresAt };
  });
}
export async function logout(loginSessionToken: string | undefined) {
  if (!loginSessionToken) return;
  await databases().records.transaction(async tx => {
    try {
      const who = await identity(tx, loginSessionToken, false);
      await tx.update(loginSessions).set({ loginSessionInvalidatedAt: await dbNow(tx) }).where(eq(loginSessions.loginSessionId, who.loginSessionId));
    } catch (error) { if (!(error instanceof AppError) || error.code !== "LOGIN_REQUIRED") throw error; }
  });
}
export async function deleteAccount(loginSessionToken: string | undefined) {
  return withIdentity(loginSessionToken, async (tx, who) => {
    const [session] = await tx.select().from(loginSessions).where(eq(loginSessions.loginSessionId, who.loginSessionId)).for("update");
    const now = await dbNow(tx);
    if (!session?.accountDeletionAuthorizationExpiresAt || session.accountDeletionAuthorizationUsedAt || session.accountDeletionAuthorizationExpiresAt <= now) throw new AppError("CONFIRM_DELETE_FIRST", 403);
    await tx.update(loginSessions).set({ accountDeletionAuthorizationUsedAt: now }).where(eq(loginSessions.loginSessionId, who.loginSessionId));
    await tx.update(users).set({ accountDeletionConfirmedAt: now }).where(eq(users.userId, who.userId));
    await tx.update(loginSessions).set({ loginSessionInvalidatedAt: now }).where(eq(loginSessions.userId, who.userId));
    await tx.update(emailAuthRequests).set({ authLinkInvalidatedAt: now }).where(eq(emailAuthRequests.emailAddress, who.emailAddress));
    await tx.insert(scheduledJobs).values({ targetUserId: who.userId, jobType: "delete_account", scheduledRunAt: now });
  });
}
