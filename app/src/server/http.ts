import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { AppError, getLocalConfig } from "./config";
export const LOGIN_SESSION_COOKIE_NAME = "talkie_session";

export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const cfg = getLocalConfig();
  // Next's internal request URL may use localhost even when the configured listener is 127.0.0.1.
  // Check the actual Host and browser Origin against the fixed local configuration; never trust forwarded headers.
  if (request.headers.get("host") !== new URL(cfg.origin).host || request.headers.get("origin") !== cfg.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("FORBIDDEN_ORIGIN", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_REQUEST");
  let total = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 300 * 1024) { await reader.cancel(); throw new AppError("REQUEST_TOO_LARGE", 413); }
    parts.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AppError("INVALID_REQUEST"); }
}
export function jsonResponse(value: unknown, loginSessionToken?: string, maxAgeSeconds = 30 * 86400) {
  const res = NextResponse.json(value, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  if (loginSessionToken !== undefined) res.cookies.set(LOGIN_SESSION_COOKIE_NAME, loginSessionToken, { httpOnly: true, secure: getLocalConfig().secure, sameSite: "lax", path: "/", maxAge: maxAgeSeconds });
  return res;
}
export function errorResponse(error: unknown) {
  const known = error instanceof AppError;
  return NextResponse.json({ error: known ? error.code : "SERVICE_UNAVAILABLE" }, { status: known ? error.status : 503,
    headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
}
export function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) throw new AppError("INVALID_REQUEST");
  return value;
}
