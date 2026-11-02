import { NextRequest, NextResponse } from "next/server";
import { AppError, getLocalConfig } from "../../../../../server/config";
import { LOGIN_SESSION_COOKIE_NAME } from "../../../../../server/http";
import { completeGoogleAuth, exchangeGoogleCode, GOOGLE_OAUTH_COOKIE_NAME, GOOGLE_OAUTH_COOKIE_PATH, readGoogleOAuthState, type GoogleOAuthState } from "../../../../../server/google-auth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const { origin, secure } = getLocalConfig();
  let value: GoogleOAuthState | undefined;
  let target: string;
  let session: { loginSessionToken: string; expiresAt: Date } | undefined;
  try {
    value = readGoogleOAuthState(request.cookies.get(GOOGLE_OAUTH_COOKIE_NAME)?.value);
    // Rebuild the callback URL on the configured origin; never trust Host/forwarded headers.
    const callbackUrl = new URL(`/api/auth/google/callback${request.nextUrl.search}`, origin);
    const claims = await exchangeGoogleCode(callbackUrl, value);
    const result = await completeGoogleAuth(value, claims, request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value);
    if ("loginSessionToken" in result) session = result;
    target = result.purpose === "login" ? "/home" : `/account?google=${result.purpose === "link" ? "linked" : "reauthenticated"}`;
  } catch (error) {
    const code = error instanceof AppError ? error.code : "GOOGLE_AUTH_FAILED";
    target = `${!value || value.purpose === "login" ? "/login" : "/account"}?error=${code}`;
  }
  const response = NextResponse.redirect(`${origin}${target}`, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
  response.cookies.set(GOOGLE_OAUTH_COOKIE_NAME, "", { httpOnly: true, secure, sameSite: "lax", path: GOOGLE_OAUTH_COOKIE_PATH, maxAge: 0 });
  if (session) response.cookies.set(LOGIN_SESSION_COOKIE_NAME, session.loginSessionToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 30 * 86400 });
  return response;
}
