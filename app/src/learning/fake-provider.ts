import { buildNote } from "./note";
import type { Note, NoteRequest, LearningProvider, LearningReply, LearningRequest } from "./types";

export type DemoScenario = "correction" | "conversation";

export class FakeProvider implements LearningProvider {
  private replies = new Map<string, LearningReply>();
  private notes = new Map<string, Note>();
  failNextReply = false;
  failNextNote = false;
  delayMs = 650;

  constructor(readonly scenario: DemoScenario = "correction") {}

  async respond(request: LearningRequest): Promise<LearningReply> {
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    if (this.failNextReply) {
      this.failNextReply = false;
      throw new Error("SIMULATED_REPLY_FAILURE");
    }
    const cached = this.replies.get(request.requestId);
    if (cached) return cached;
    let reply: LearningReply;
    if (request.text === undefined) {
      reply = { text: "Let's talk about yesterday. What did you do yesterday?", learningState: "conversation" };
    } else if (this.scenario === "correction" && request.corrections.length === 0) {
      // Deliberately fixed example. This does not evaluate or rewrite arbitrary input.
      reply = {
        text: "Thanks for sharing. 데모 표현: I went to a café yesterday. 이 표현을 한 번 말해 볼까요?",
        learningState: "retry",
        correction: { replacement: "I went to a café yesterday.", explanation: "과거의 일을 말할 때 go의 과거형 went를 쓰는 예시입니다. 입력의 실제 오류를 판정한 교정이 아닌 고정 시나리오입니다." },
      };
    } else if (request.learningState === "retry") {
      const failedOnce = request.corrections.at(-1)!.attempts.length > 0;
      reply = failedOnce
        ? { text: "재시도 성공 시나리오입니다. What do you like to do on weekends?", learningState: "conversation", retryOutcome: "success" }
        : { text: "재시도 실패 시나리오입니다. 데모 표현: I went to a café yesterday. 한 번 더 말해 볼까요?", learningState: "retry", retryOutcome: "failure" };
    } else {
      const questions = ["What do you enjoy about your neighborhood?", "How do you usually relax after a busy day?", "What would you like to do next weekend?"];
      const count = request.turns.filter(t => t.role === "user").length;
      reply = { text: `Thanks for sharing. ${questions[count % questions.length]}`, learningState: "conversation" };
    }
    this.replies.set(request.requestId, reply);
    return reply;
  }

  async createNote(request: NoteRequest): Promise<Note> {
    await new Promise(resolve => setTimeout(resolve, this.delayMs));
    if (this.failNextNote) {
      this.failNextNote = false;
      throw new Error("SIMULATED_NOTE_FAILURE");
    }
    const note = this.notes.get(request.requestId) ?? buildNote(request);
    this.notes.set(request.requestId, note);
    return note;
  }
}
