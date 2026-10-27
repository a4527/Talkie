import { NextRequest } from "next/server";
import { AppError } from "../../../server/config";
import { readJsonBody, LOGIN_SESSION_COOKIE_NAME, errorResponse, jsonResponse, requireString } from "../../../server/http";
import { endLearning, completeLearningNote, updateLearningHeartbeat, listLearningRecords, saveLearning, startLearning } from "../../../server/learning";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const loginSessionToken = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    return jsonResponse(await listLearningRecords(loginSessionToken), loginSessionToken);
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const data = await readJsonBody(request), loginSessionToken = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    if (data.action === "start") return jsonResponse(await startLearning(loginSessionToken, requireString(data.scenario)), loginSessionToken);
    const learningSessionId = requireString(data.learningSessionId);
    if (data.action === "note") { await completeLearningNote(loginSessionToken, learningSessionId); return jsonResponse({ ok: true }, loginSessionToken); }
    const learningConnectionToken = requireString(data.learningConnectionToken);
    if (data.action === "save") return jsonResponse(await saveLearning(loginSessionToken, learningSessionId, learningConnectionToken, Number(data.saveSequenceNumber), data.conversationSnapshot), loginSessionToken);
    if (data.action === "end") return jsonResponse(await endLearning(loginSessionToken, learningSessionId, learningConnectionToken), loginSessionToken);
    if (data.action === "heartbeat" || data.action === "pause") {
      await updateLearningHeartbeat(loginSessionToken, learningSessionId, learningConnectionToken, data.action === "pause");
      return jsonResponse({ ok: true }, loginSessionToken);
    }
    throw new AppError("INVALID_REQUEST");
  } catch (error) { return errorResponse(error); }
}
