import { NextRequest } from "next/server";
import { consumeLink, deleteAccount, inspectLink, logout, requestLink, withIdentity } from "../../../server/auth";
import { AppError } from "../../../server/config";
import { readJsonBody, LOGIN_SESSION_COOKIE_NAME, errorResponse, jsonResponse, requireString } from "../../../server/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const loginSessionToken = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    const who = await withIdentity(loginSessionToken, async (_tx, who) => ({ emailAddress: who.emailAddress }));
    return jsonResponse(who, loginSessionToken);
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const data = await readJsonBody(request), loginSessionToken = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    switch (data.action) {
      case "request":
        if (data.purpose !== "login" && data.purpose !== "account_deletion") throw new AppError("INVALID_REQUEST");
        await requestLink(data.emailAddress, data.purpose, loginSessionToken);
        return jsonResponse({ accepted: true });
      case "inspect": return jsonResponse(await inspectLink(requireString(data.authLinkToken)));
      case "confirm": {
        const result = await consumeLink(requireString(data.authLinkToken), loginSessionToken);
        return jsonResponse({ purpose: result.purpose }, result.purpose === "login" ? result.loginSessionToken : loginSessionToken);
      }
      case "logout": await logout(loginSessionToken); return jsonResponse({ ok: true }, "", 0);
      case "delete": await deleteAccount(loginSessionToken); return jsonResponse({ ok: true }, "", 0);
      default: throw new AppError("INVALID_REQUEST");
    }
  } catch (error) { return errorResponse(error); }
}
