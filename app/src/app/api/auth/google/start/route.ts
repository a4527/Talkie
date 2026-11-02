import { NextRequest, NextResponse } from "next/server";
import { AppError, getLocalConfig } from "../../../../../server/config";
import { LOGIN_SESSION_COOKIE_NAME } from "../../../../../server/http";
import { beginGoogleAuth, GOOGLE_OAUTH_COOKIE_NAME, GOOGLE_OAUTH_COOKIE_PATH, type GoogleAuthPurpose } from "../../../../../server/google-auth";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const purpose = request.nextUrl.searchParams.get("purpose") ?? "login";
  const back = purpose === "login" ? "/login" : "/account";
  const origin = getLocalConfig().origin;
  try {
    if (!["login", "link", "reauth"].includes(purpose)) throw new AppError("INVALID_REQUEST");
    // Only same-origin navigations may begin a flow; a cross-site page cannot start a link or reauth.
    if (request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("FORBIDDEN_ORIGIN", 403);
    const { url, cookie } = await beginGoogleAuth(purpose as GoogleAuthPurpose, request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value);
    const response = NextResponse.redirect(url, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
    response.cookies.set(GOOGLE_OAUTH_COOKIE_NAME, cookie, { httpOnly: true, secure: getLocalConfig().secure, sameSite: "lax", path: GOOGLE_OAUTH_COOKIE_PATH, maxAge: 600 });
    return response;
  } catch (error) {
    const code = error instanceof AppError ? error.code : "GOOGLE_AUTH_FAILED";
    return NextResponse.redirect(`${origin}${back}?error=${code}`, { headers: { "Cache-Control": "no-store, private" } });
  }
}
