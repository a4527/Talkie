import { NextRequest } from "next/server";
import { consumeLink, deleteAccount, inspectLink, logout, requestLink, withIdentity } from "../../../server/auth";
import { AppError } from "../../../server/config";
import { body, COOKIE, failure, response, string } from "../../../server/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const secret = request.cookies.get(COOKIE)?.value;
    const who = await withIdentity(secret, async (_tx, who) => ({ email: who.email }));
    return response(who, secret);
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const data = await body(request), secret = request.cookies.get(COOKIE)?.value;
    switch (data.action) {
      case "request":
        if (data.purpose !== "login" && data.purpose !== "account_deletion") throw new AppError("INVALID_REQUEST");
        await requestLink(data.email, data.purpose, secret);
        return response({ accepted: true });
      case "inspect": return response(await inspectLink(string(data.token)));
      case "confirm": {
        const result = await consumeLink(string(data.token), secret);
        return response({ purpose: result.purpose }, result.purpose === "login" ? result.secret : secret);
      }
      case "logout": await logout(secret); return response({ ok: true }, "", 0);
      case "delete": await deleteAccount(secret); return response({ ok: true }, "", 0);
      default: throw new AppError("INVALID_REQUEST");
    }
  } catch (error) { return failure(error); }
}
