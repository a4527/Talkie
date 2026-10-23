import { validateNote } from "./note";
import { boundRecords } from "./buffer";
import type { Metric, NoteRequest, Provider, Request, Session, Turn } from "./types";

export class LearningSession {
  private state: Session;
  private listeners = new Set<() => void>();
  private inFlight = new Set<string>();
  private completed = new Set<string>();
  private noteInFlight = false;
  private sequence = 0;
  private acknowledged = new Set<string>();

  acknowledge(turns: Session["turns"]) {
    for (const turn of turns) this.acknowledged.add(turn.requestId);
    const live = new Set(this.state.turns.map(t => t.requestId));
    this.acknowledged = new Set([...this.acknowledged].filter(id => live.has(id)));
  }

  constructor(private provider: Provider, private id = () => crypto.randomUUID(), private now = () => Date.now(),
    private storage?: { id: string; turns: Session["turns"]; corrections: Session["corrections"]; learning: Session["learning"]; gaps?: boolean; maxBytes: number }) {
    this.state = {
      sessionId: this.id(), phase: "ready", learning: "conversation", turns: [], corrections: [],
      noteStatus: "idle", message: "", metrics: [],
    };
    if (storage) {
      this.state = { ...this.state, sessionId: storage.id, turns: storage.turns, corrections: storage.corrections,
        learning: storage.learning, phase: storage.turns.length ? storage.learning : "ready", gaps: storage.gaps };
      this.sequence = Math.max(0, ...storage.turns.map(t => Number(t.id.split("-t").at(-1)) || 0));
      this.acknowledge(storage.turns);
    }
  }

  getSnapshot = (): Session => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(patch: Partial<Session>, metric?: Metric) {
    this.state = { ...this.state, ...patch,
      metrics: metric ? [...this.state.metrics, metric].slice(-100) : this.state.metrics };
    if (this.storage) {
      const bounded = boundRecords(this.state.turns, this.state.corrections, this.storage.maxBytes);
      if (bounded.dropped) this.state = { ...this.state, turns: bounded.turns, corrections: bounded.corrections,
        gaps: this.state.gaps || bounded.removed.some(id => !this.acknowledged.has(id)) };
    }
    this.listeners.forEach(listener => listener());
  }

  private transition(phase: Session["phase"], message = "") {
    this.update({ phase, message }, {
      requestId: this.state.pending?.requestId ?? this.state.sessionId,
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
    const request: Request = {
      sessionId: this.state.sessionId, requestId: this.id(), text,
      learning: this.state.learning, turns: this.state.turns, corrections: this.state.corrections,
    };
    this.update({ pending: request });
    this.transition("waiting");
    void this.deliver(request);
  }

  private async deliver(request: Request) {
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
        id: `${this.state.sessionId}-t${++this.sequence}`, requestId: request.requestId, role: "user", text: request.text,
      };
      const assistant: Turn = {
        id: `${this.state.sessionId}-t${++this.sequence}`, requestId: request.requestId, role: "assistant", text: reply.text,
      };
      let corrections = [...this.state.corrections];
      if (reply.retryOutcome && user && corrections.length) {
        const last = corrections.at(-1)!;
        corrections = [...corrections.slice(0, -1), { ...last, attempts: [...last.attempts, { turnId: user.id, outcome: reply.retryOutcome }] }];
      }
      if (reply.correction && user) corrections.push({
        id: request.requestId, sourceTurnId: user.id, deliveredTurnId: assistant.id,
        ...reply.correction, attempts: [],
      });
      this.completed.add(request.requestId);
      this.update({
        phase: reply.learning, learning: reply.learning, pending: undefined, message: "",
        turns: [...this.state.turns, ...(user ? [user] : []), assistant], corrections, lastConfirmedTurnId: assistant.id,
      }, { requestId: request.requestId, event: "response", from: "waiting", to: reply.learning, result: "ok", elapsedMs: this.now() - began });
    } catch {
      if (this.state.phase !== "ended" && this.state.pending?.requestId === request.requestId) {
        this.update({ phase: "paused", message: "데모 응답에 실패했습니다. 이어서 하기를 누르면 같은 요청을 다시 확인합니다." }, {
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
    } else this.transition(this.state.learning);
  }

  end() {
    if (["ready", "ended"].includes(this.state.phase)) return;
    this.update({ endedAt: new Date(this.now()).toISOString(), pending: undefined });
    this.transition("ended");
    if (!this.state.turns.some(t => t.role === "user")) {
      this.update({ noteStatus: "empty", message: "확인된 내 답변이 없어 노트를 만들지 않았습니다." });
    } else void this.generateNote();
  }

  async generateNote() {
    if (this.state.phase !== "ended" || this.noteInFlight || ["ready", "empty"].includes(this.state.noteStatus)) return;
    this.noteInFlight = true;
    this.update({ noteStatus: "loading", message: "확인된 대화로 노트를 정리하고 있습니다." });
    const request: NoteRequest = {
      requestId: `${this.state.sessionId}-note`, endedAt: this.state.endedAt!,
      turns: this.state.turns, corrections: this.state.corrections,
    };
    const began = this.now();
    try {
      const note = await this.provider.createNote(request);
      if (!validateNote(note, request)) throw new Error("INVALID_EVIDENCE");
      this.update({ noteStatus: "ready", note, message: "대화가 종료됐습니다. 노트를 확인하고 내려받으세요." }, {
        requestId: request.requestId, event: "note", from: "ended", to: "ended", result: "ok", elapsedMs: this.now() - began,
      });
    } catch {
      this.update({ noteStatus: "failed", message: "노트 정리에 실패했습니다. 대화는 종료된 상태이며 노트만 다시 만들 수 있습니다." }, {
        requestId: request.requestId, event: "note", from: "ended", to: "ended", result: "failed", elapsedMs: this.now() - began,
      });
    } finally { this.noteInFlight = false; }
  }
}
