import { validateNote } from "./note";
import { boundRecords } from "./buffer";
import type { LearningMetric, NoteRequest, LearningProvider, LearningRequest, LearningSessionState, Turn } from "./types";

export class LearningSession {
  private state: LearningSessionState;
  private listeners = new Set<() => void>();
  private inFlight = new Set<string>();
  private completed = new Set<string>();
  private noteInFlight = false;
  private sequence = 0;
  private acknowledged = new Set<string>();

  acknowledge(turns: LearningSessionState["turns"]) {
    for (const turn of turns) this.acknowledged.add(turn.requestId);
    const live = new Set(this.state.turns.map(t => t.requestId));
    this.acknowledged = new Set([...this.acknowledged].filter(id => live.has(id)));
  }

  constructor(private provider: LearningProvider, private createId = () => crypto.randomUUID(), private now = () => Date.now(),
    private storage?: { learningSessionId: string; turns: LearningSessionState["turns"]; corrections: LearningSessionState["corrections"]; learningState: LearningSessionState["learningState"]; hasConversationGaps?: boolean; maxBytes: number }) {
    this.state = {
      learningSessionId: this.createId(), phase: "ready", learningState: "conversation", turns: [], corrections: [],
      noteGenerationStatus: "idle", statusMessage: "", metrics: [],
    };
    if (storage) {
      this.state = { ...this.state, learningSessionId: storage.learningSessionId, turns: storage.turns, corrections: storage.corrections,
        learningState: storage.learningState, phase: storage.turns.length ? storage.learningState : "ready", hasConversationGaps: storage.hasConversationGaps };
      this.sequence = Math.max(0, ...storage.turns.map(t => Number(t.turnId.split("-t").at(-1)) || 0));
      this.acknowledge(storage.turns);
    }
  }

  getSnapshot = (): LearningSessionState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<LearningSessionState>, metric?: LearningMetric) {
    this.state = { ...this.state, ...patch,
      metrics: metric ? [...this.state.metrics, metric].slice(-100) : this.state.metrics };
    if (this.storage) {
      const bounded = boundRecords(this.state.turns, this.state.corrections, this.storage.maxBytes);
      if (bounded.dropped) this.state = { ...this.state, turns: bounded.turns, corrections: bounded.corrections,
        hasConversationGaps: this.state.hasConversationGaps || bounded.removed.some(id => !this.acknowledged.has(id)) };
    }
    this.listeners.forEach(listener => listener());
  }

  private transition(phase: LearningSessionState["phase"], statusMessage = "") {
    this.update({ phase, statusMessage }, {
      requestId: this.state.pending?.requestId ?? this.state.learningSessionId,
      event: "transition", from: this.state.phase, to: phase, result: "ok", elapsedMs: 0,
    });
  }

  start() {
    if (this.state.phase !== "ready") return;
    this.request();
  }

  send(text: string): boolean {
    if (!["conversation", "retry"].includes(this.state.phase) || !text.trim()) return false;
    this.request(text.trim());
    return true;
  }

  private request(text?: string) {
    const request: LearningRequest = {
      learningSessionId: this.state.learningSessionId, requestId: this.createId(), text,
      learningState: this.state.learningState, turns: this.state.turns, corrections: this.state.corrections,
    };
    this.update({ pending: request });
    this.transition("waiting");
    void this.deliver(request);
  }

  private async deliver(request: LearningRequest) {
    if (this.inFlight.has(request.requestId) || this.completed.has(request.requestId)) return;
    this.inFlight.add(request.requestId);
    const began = this.now();
    try {
      const reply = await this.provider.respond(request);
      if (this.state.phase === "ended" || this.state.pending?.requestId !== request.requestId || this.completed.has(request.requestId)) {
        this.update({}, { requestId: request.requestId, event: "response", from: this.state.phase, to: this.state.phase, result: "ignored", elapsedMs: this.now() - began });
        return;
      }
      // While paused, the request stays unconfirmed. Resume rechecks the same ID.
      if (this.state.phase === "paused") return;
      const user: Turn | undefined = request.text === undefined ? undefined : {
        turnId: `${this.state.learningSessionId}-t${++this.sequence}`, requestId: request.requestId, role: "user", text: request.text,
      };
      const assistant: Turn = {
        turnId: `${this.state.learningSessionId}-t${++this.sequence}`, requestId: request.requestId, role: "assistant", text: reply.text,
      };
      let corrections = [...this.state.corrections];
      if (reply.retryOutcome && user && corrections.length) {
        const last = corrections.at(-1)!;
        corrections = [...corrections.slice(0, -1), { ...last, attempts: [...last.attempts, { turnId: user.turnId, outcome: reply.retryOutcome }] }];
      }
      if (reply.correction && user) corrections.push({
        correctionId: request.requestId, sourceTurnId: user.turnId, deliveredTurnId: assistant.turnId,
        ...reply.correction, attempts: [],
      });
      this.completed.add(request.requestId);
      this.update({
        phase: reply.learningState, learningState: reply.learningState, pending: undefined, statusMessage: "",
        turns: [...this.state.turns, ...(user ? [user] : []), assistant], corrections, lastConfirmedTurnId: assistant.turnId,
      }, { requestId: request.requestId, event: "response", from: "waiting", to: reply.learningState, result: "ok", elapsedMs: this.now() - began });
    } catch {
      if (this.state.phase !== "ended" && this.state.pending?.requestId === request.requestId) {
        this.update({ phase: "paused", statusMessage: "데모 응답에 실패했습니다. 이어서 하기를 누르면 같은 요청을 다시 확인합니다." }, {
          requestId: request.requestId, event: "response", from: this.state.phase, to: "paused", result: "failed", elapsedMs: this.now() - began,
        });
      }
    } finally {
      this.inFlight.delete(request.requestId);
    }
  }

  pause() {
    if (["ready", "ended", "paused"].includes(this.state.phase)) return;
    this.transition("paused", "일시 중단했습니다. 같은 화면에서 확인된 대화부터 이어갈 수 있습니다.");
  }

  resume() {
    if (this.state.phase !== "paused") return;
    if (this.state.pending) {
      this.transition("waiting");
      void this.deliver(this.state.pending!);
    } else this.transition(this.state.learningState);
  }

  end() {
    if (["ready", "ended"].includes(this.state.phase)) return;
    this.update({ endedAt: new Date(this.now()).toISOString(), pending: undefined });
    this.transition("ended");
    if (!this.state.turns.some(t => t.role === "user")) {
      this.update({ noteGenerationStatus: "empty", statusMessage: "확인된 내 답변이 없어 노트를 만들지 않았습니다." });
    } else void this.generateNote();
  }

  async generateNote() {
    if (this.state.phase !== "ended" || this.noteInFlight || ["ready", "empty"].includes(this.state.noteGenerationStatus)) return;
    this.noteInFlight = true;
    this.update({ noteGenerationStatus: "loading", statusMessage: "확인된 대화로 노트를 정리하고 있습니다." });
    const request: NoteRequest = {
      requestId: `${this.state.learningSessionId}-note`, endedAt: this.state.endedAt!,
      turns: this.state.turns, corrections: this.state.corrections,
    };
    const began = this.now();
    try {
      const note = await this.provider.createNote(request);
      if (!validateNote(note, request)) throw new Error("INVALID_EVIDENCE");
      this.update({ noteGenerationStatus: "ready", note, statusMessage: "대화가 종료됐습니다. 노트를 확인하고 내려받으세요." }, {
        requestId: request.requestId, event: "note", from: "ended", to: "ended", result: "ok", elapsedMs: this.now() - began,
      });
    } catch {
      this.update({ noteGenerationStatus: "failed", statusMessage: "노트 정리에 실패했습니다. 대화는 종료된 상태이며 노트만 다시 만들 수 있습니다." }, {
        requestId: request.requestId, event: "note", from: "ended", to: "ended", result: "failed", elapsedMs: this.now() - began,
      });
    } finally { this.noteInFlight = false; }
  }
}
