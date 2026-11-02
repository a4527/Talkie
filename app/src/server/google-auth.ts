import "server-only";
import { and, eq, sql } from "drizzle-orm";
import * as oidc from "openid-client";
import { AppError, getLocalConfig, normalizeTestEmailAddress } from "./config";
import { databases, type RecordsTransaction } from "./db";
import { DAY, dbNow, digest, identity, token } from "./auth";
import { googleIdentities, loginSessions, users } from "./db/records-schema";

/** login: sign in or create; link: attach to the current account; reauth: account deletion reconfirmation. */
export type GoogleAuthPurpose = "login" | "link" | "reauth";
export const GOOGLE_OAUTH_COOKIE_NAME = "talkie_google_oauth";
export const GOOGLE_OAUTH_COOKIE_PATH = "/api/auth/google";
export type GoogleOAuthState = { purpose: GoogleAuthPurpose; state: string; nonce: string; codeVerifier: string; loginSessionId?: string };
export type GoogleClaims = { sub: string; email?: unknown; email_verified?: unknown };

export function googleLoginAvailable() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
export function googleRedirectUri() { return `${getLocalConfig().origin}/api/auth/google/callback`; }

let configuration: Promise<oidc.Configuration> | undefined;
function googleConfiguration() {
  if (!googleLoginAvailable()) throw new AppError("GOOGLE_LOGIN_DISABLED", 503);
  configuration ??= oidc.discovery(new URL("https://accounts.google.com"), process.env.GOOGLE_OAUTH_CLIENT_ID!, process.env.GOOGLE_OAUTH_CLIENT_SECRET!)
    .catch(error => { configuration = undefined; throw error; });
  return configuration;
}

export async function beginGoogleAuth(purpose: GoogleAuthPurpose, loginSessionToken: string | undefined) {
  let loginSessionId: string | undefined;
  if (purpose !== "login") {
    loginSessionId = await databases().records.transaction(async tx => (await identity(tx, loginSessionToken, false)).loginSessionId);
  }
  const config = await googleConfiguration();
  const value: GoogleOAuthState = { purpose, state: oidc.randomState(), nonce: oidc.randomNonce(), codeVerifier: oidc.randomPKCECodeVerifier(), loginSessionId };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: googleRedirectUri(), scope: "openid email", response_type: "code",
    code_challenge: await oidc.calculatePKCECodeChallenge(value.codeVerifier), code_challenge_method: "S256",
    state: value.state, nonce: value.nonce,
    // Google has no prompt=login/auth_time; the account chooser at least requires a fresh user action.
    ...(purpose === "login" ? {} : { prompt: "select_account" }),
  });
  return { url, cookie: Buffer.from(JSON.stringify(value)).toString("base64url") };
}

export function readGoogleOAuthState(cookie: string | undefined): GoogleOAuthState {
  try {
    const value = JSON.parse(Buffer.from(cookie ?? "", "base64url").toString("utf8"));
    if (["login", "link", "reauth"].includes(value.purpose) && [value.state, value.nonce, value.codeVerifier].every(v => typeof v === "string" && v.length >= 32)) return value;
  } catch {}
  throw new AppError("GOOGLE_AUTH_EXPIRED");
}

/** Exchanges the code at Google's token endpoint over TLS and validates iss/aud/exp/nonce/state/PKCE. */
export async function exchangeGoogleCode(callbackUrl: URL, value: GoogleOAuthState): Promise<GoogleClaims> {
  const config = await googleConfiguration();
  try {
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, { pkceCodeVerifier: value.codeVerifier, expectedState: value.state, expectedNonce: value.nonce, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("missing subject");
    return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified };
  } catch (error) {
    if (error instanceof oidc.AuthorizationResponseError && error.error === "access_denied") throw new AppError("GOOGLE_AUTH_CANCELLED");
    throw new AppError("GOOGLE_AUTH_FAILED");
  }
}

function verifiedEmail(claims: GoogleClaims) {
  if (claims.email_verified !== true || typeof claims.email !== "string" || claims.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(claims.email)) throw new AppError("GOOGLE_EMAIL_UNVERIFIED");
  const at = claims.email.lastIndexOf("@");
  return claims.email.slice(0, at) + "@" + claims.email.slice(at + 1).toLowerCase();
}

async function createLoginSession(tx: RecordsTransaction, userId: string) {
  const now = await dbNow(tx), loginSessionToken = token(), expiresAt = new Date(now.getTime() + 30 * DAY);
  await tx.insert(loginSessions).values({ userId, loginTokenHash: digest(loginSessionToken), loginSessionCreatedAt: now, lastAuthenticatedActivityAt: now, loginSessionExpiresAt: expiresAt });
  return { loginSessionToken, expiresAt };
}

async function currentIdentity(tx: RecordsTransaction, loginSessionToken: string | undefined) {
  try { return await identity(tx, loginSessionToken, false); }
  catch (error) { if (error instanceof AppError && error.code === "LOGIN_REQUIRED") return undefined; throw error; }
}

/**
 * Applies a validated Google identity. Accounts are linked only explicitly (DEC-067):
 * an unknown subject whose email already belongs to an account is refused, never merged.
 */
export async function completeGoogleAuth(value: GoogleOAuthState, claims: GoogleClaims, loginSessionToken: string | undefined) {
  return databases().records.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"google:" + claims.sub}, 0))`);
    const [linked] = await tx.select().from(googleIdentities).where(eq(googleIdentities.googleSubject, claims.sub));
    if (value.purpose === "login") {
      const current = await currentIdentity(tx, loginSessionToken);
      if (linked) {
        const [user] = await tx.select().from(users).where(eq(users.userId, linked.userId)).for("update");
        if (!user || user.accountDeletionConfirmedAt) throw new AppError("GOOGLE_ACCOUNT_UNAVAILABLE", 403);
        if (current && current.userId !== user.userId) throw new AppError("LOGOUT_FIRST", 409);
        return { purpose: value.purpose, ...await createLoginSession(tx, user.userId) };
      }
      const email = verifiedEmail(claims);
      if (current) throw new AppError("LOGOUT_FIRST", 409);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`);
      const [existing] = await tx.select({ userId: users.userId }).from(users).where(eq(users.emailAddress, email));
      if (existing) throw new AppError("GOOGLE_EMAIL_IN_USE", 409);
      const [user] = await tx.insert(users).values({ emailAddress: email }).returning();
      await tx.insert(googleIdentities).values({ googleSubject: claims.sub, userId: user.userId, googleEmailAddress: email, googleIdentityLinkedAt: await dbNow(tx) });
      return { purpose: value.purpose, ...await createLoginSession(tx, user.userId) };
    }
    const who = await identity(tx, loginSessionToken);
    if (!value.loginSessionId || who.loginSessionId !== value.loginSessionId) throw new AppError("ORIGINAL_BROWSER_REQUIRED", 403);
    const [own] = await tx.select().from(googleIdentities).where(eq(googleIdentities.userId, who.userId)).for("update");
    if (value.purpose === "link") {
      if (own) throw new AppError("GOOGLE_ALREADY_LINKED", 409);
      if (linked) throw new AppError("GOOGLE_LINKED_ELSEWHERE", 409);
      await tx.insert(googleIdentities).values({ googleSubject: claims.sub, userId: who.userId, googleEmailAddress: verifiedEmail(claims), googleIdentityLinkedAt: await dbNow(tx) });
      return { purpose: value.purpose };
    }
    if (!own || own.googleSubject !== claims.sub) throw new AppError("GOOGLE_REAUTH_MISMATCH", 403);
    const now = await dbNow(tx);
    await tx.update(loginSessions).set({ accountDeletionAuthorizationExpiresAt: new Date(now.getTime() + 600_000), accountDeletionAuthorizationUsedAt: null })
      .where(eq(loginSessions.loginSessionId, who.loginSessionId));
    return { purpose: value.purpose };
  });
}

/** Email-link login stays possible only for addresses the current mail path accepts. */
export function emailLoginAvailable(emailAddress: string) {
  try { normalizeTestEmailAddress(emailAddress); return true; } catch { return false; }
}

export async function unlinkGoogle(loginSessionToken: string | undefined) {
  await databases().records.transaction(async tx => {
    const who = await identity(tx, loginSessionToken);
    if (!emailLoginAvailable(who.emailAddress)) throw new AppError("GOOGLE_ONLY_ACCOUNT", 409);
    await tx.delete(googleIdentities).where(and(eq(googleIdentities.userId, who.userId)));
  });
}

export async function googleLinkStatus(tx: RecordsTransaction, userId: string) {
  const [row] = await tx.select({ googleEmailAddress: googleIdentities.googleEmailAddress }).from(googleIdentities).where(eq(googleIdentities.userId, userId));
  return row ? { googleEmailAddress: row.googleEmailAddress } : undefined;
}
