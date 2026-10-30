import type { NextRequest } from "next/server";
import { getVoiceLearningContext, validateConversationSnapshot } from "../../../../server/learning";
import { withIdentity } from "../../../../server/auth";
import { AppError } from "../../../../server/config";
import { readJsonBody, LOGIN_SESSION_COOKIE_NAME, errorResponse, jsonResponse, requireString } from "../../../../server/http";
import { issueCascadeCredential, authorizeCascadeRequest, recordCascadeReply, cascadeText, cascadeSpeech } from "../../../../server/voice-cascade";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const input = await readJsonBody(request);
    if (input.testOnly !== true) throw new AppError("VOICE_TEST_ACK_REQUIRED", 403);
    const token = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    let prior;
    let userId: string;
    if (input.learningSessionId !== undefined) {
      const linked = await getVoiceLearningContext(token, requireString(input.learningSessionId), requireString(input.learningConnectionToken));
      prior = linked.priorLearningContext; userId = linked.userId;
    } else userId = await withIdentity(token, async (_tx, who) => who.userId);
    const learningSessionId = typeof input.learningSessionId === "string" ? input.learningSessionId : undefined;
    if (input.action === "credential") {
      return jsonResponse({ ...await issueCascadeCredential(userId, fetch, learningSessionId), priorLearningContext: prior }, token);
    }
    if (input.action === "text") {
      const release = authorizeCascadeRequest(input.cascadeRequestToken, userId, "text", learningSessionId);
      try { const context = validateConversationSnapshot(input.context);
        if (context.turns.length === 0 || context.turns.at(-1)?.role !== "user") throw new AppError("INVALID_REQUEST");
        if (context.turns.length > 20 || new TextEncoder().encode(context.turns.map(turn => turn.text).join("")).length > 20 * 1024) throw new AppError("INVALID_REQUEST");
        const result = await cascadeText(context, prior, learningSessionId !== undefined, request.signal);
        recordCascadeReply(input.cascadeRequestToken, userId, learningSessionId, result.text);
        return jsonResponse(result, token);
      } finally { release(); }
    }
    if (input.action === "speech") {
      const release = authorizeCascadeRequest(input.cascadeRequestToken, userId, "speech", learningSessionId, input.text as string);
      try { const text = input.text;
        if (typeof text !== "string" || !text.trim() || text.length > 6000) throw new AppError("INVALID_REQUEST");
        const pcm = await cascadeSpeech(text, request.signal);
        return new Response(new Uint8Array(pcm), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
      } finally { release(); }
    }
    throw new AppError("INVALID_REQUEST");
  } catch (error) { return errorResponse(error); }
}
