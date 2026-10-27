import type { NextRequest } from "next/server";
import { withIdentity } from "../../../../server/auth";
import { AppError } from "../../../../server/config";
import { readJsonBody, LOGIN_SESSION_COOKIE_NAME, errorResponse, jsonResponse } from "../../../../server/http";
import { issueVoiceToken } from "../../../../server/voice-token";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const input = await readJsonBody(request);
    if (input.testOnly !== true) throw new AppError("VOICE_TEST_ACK_REQUIRED", 403);
    const loginSessionToken = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    const userId = await withIdentity(loginSessionToken, async (_tx, who) => who.userId);
    return jsonResponse(await issueVoiceToken(userId), loginSessionToken);
  } catch (error) { return errorResponse(error); }
}
