import { NextRequest } from "next/server";
import { AppError } from "../../../server/config";
import { body, COOKIE, failure, response, string } from "../../../server/http";
import { endLearning, finishNote, heartbeat, listRecords, saveLearning, startLearning } from "../../../server/learning";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const secret = request.cookies.get(COOKIE)?.value;
    return response(await listRecords(secret), secret);
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const data = await body(request), raw = request.cookies.get(COOKIE)?.value;
    if (data.action === "start") return response(await startLearning(raw, string(data.scenario)), raw);
    const id = string(data.id);
    if (data.action === "note") { await finishNote(raw, id); return response({ ok: true }, raw); }
    const secret = string(data.connection);
    if (data.action === "save") return response(await saveLearning(raw, id, secret, Number(data.saveSequenceNumber), data.conversationSnapshot), raw);
    if (data.action === "end") return response(await endLearning(raw, id, secret), raw);
    if (data.action === "heartbeat" || data.action === "pause") {
      await heartbeat(raw, id, secret, data.action === "pause");
      return response({ ok: true }, raw);
    }
    throw new AppError("INVALID_REQUEST");
  } catch (error) { return failure(error); }
}
