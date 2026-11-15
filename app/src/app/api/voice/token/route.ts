import { getVoiceLearningContext } from "../../../../server/learning";
import type { NextRequest } from "next/server";
import { withIdentity } from "../../../../server/auth";
import { AppError } from "../../../../server/config";
import { readJsonBody, LOGIN_SESSION_COOKIE_NAME, errorResponse, jsonResponse, requireString } from "../../../../server/http";
import { issueVoiceToken } from "../../../../server/voice-token";
import { createMissionInstruction } from "../../../../mission/prompt";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const input = await readJsonBody(request);
    if (input.testOnly !== true) throw new AppError("VOICE_TEST_ACK_REQUIRED", 403);
    const loginSessionToken = request.cookies.get(LOGIN_SESSION_COOKIE_NAME)?.value;
    const learning = input.learningSessionId !== undefined;
    if (learning) {
      const { userId, priorLearningContext, mission } = await getVoiceLearningContext(loginSessionToken, requireString(input.learningSessionId), requireString(input.learningConnectionToken));
      const missionSetup = mission && { missionMode: mission.missionMode, instruction: createMissionInstruction(mission.definition, mission.missionMode, mission.languageLevel) };
      return jsonResponse({ ...await issueVoiceToken(userId, fetch, true, missionSetup), priorLearningContext, ...(mission ? { missionMode: mission.missionMode } : {}) }, loginSessionToken);
    }
    const userId = await withIdentity(loginSessionToken, async (_tx, who) => who.userId);
    return jsonResponse(await issueVoiceToken(userId), loginSessionToken);
  } catch (error) { return errorResponse(error); }
}
