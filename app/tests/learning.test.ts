import { describe, expect, it } from "vitest";
import { FakeProvider } from "../src/learning/fake-provider";
import { buildNote, koreaDate, markdown, validateNote } from "../src/learning/note";
import { LearningSession } from "../src/learning/session";
import type { NoteRequest, Provider, Reply, Request } from "../src/learning/types";

async function settled() { await new Promise(resolve => setTimeout(resolve, 5)); }
function setup(scenario: "correction" | "conversation" = "correction") {
  const provider = new FakeProvider(scenario);
  provider.delayMs = 0;
  let id = 0;
  const session = new LearningSession(provider, () => `id-${++id}`);
  return { provider, session, state: session.getSnapshot };
}

describe("first learning flow", () => {
  it("records correction, failed/successful retries and evidence-backed Markdown", async () => {
    const { session, state } = setup();
    session.start(); await settled();
    expect(state().turns).toHaveLength(1);
    session.send("I go to a cafe yesterday."); await settled();
    expect(state().phase).toBe("retry");
    session.send("My first retry"); await settled();
    expect(state().phase).toBe("retry");
    session.send("My second retry"); await settled();
    expect(state().phase).toBe("conversation");
    expect(state().corrections[0].attempts.map(a => a.outcome)).toEqual(["failure", "success"]);
    session.end(); await settled();
    expect(state().noteStatus).toBe("ready");
    expect(state().note!.evidence.map(e => e.text)).toEqual(["I go to a cafe yesterday.", "My first retry", "My second retry"]);
    expect(markdown(state().note!)).toContain("시나리오 성공");
  });

  it("rejects empty/duplicate submissions and duplicate starts; short answers do not end", async () => {
    const { session, state } = setup("conversation");
    session.start(); session.start(); await settled();
    expect(state().turns).toHaveLength(1);
    expect(session.send(" \n ")).toBe(false);
    expect(session.send("yes")).toBe(true);
    expect(session.send("duplicate")).toBe(false);
    await settled();
    expect(state().turns.filter(t => t.role === "user").map(t => t.text)).toEqual(["yes"]);
    expect(state().phase).toBe("conversation");
  });

  it("retries failed requests with the same ID, preserving confirmed turns and correction state", async () => {
    const { session, provider, state } = setup();
    session.start(); await settled();
    session.send("An answer"); await settled();
    const lastTurn = state().lastConfirmedTurnId;
    provider.failNextReply = true;
    session.send("A retry");
    const requestId = state().pending!.requestId;
    await settled();
    expect(state().phase).toBe("paused");
    expect(state().learning).toBe("retry");
    expect(state().lastConfirmedTurnId).toBe(lastTurn);
    session.resume();
    expect(state().pending!.requestId).toBe(requestId);
    session.resume(); await settled();
    expect(state().corrections[0].attempts).toHaveLength(1);
    expect(state().turns.filter(t => t.text === "A retry")).toHaveLength(1);
  });

  it("pauses without a pending request and restores the provider's recorded state", async () => {
    const { session, state } = setup();
    session.start(); await settled(); session.send("Answer"); await settled();
    session.pause();
    expect(state().phase).toBe("paused");
    expect(session.send("blocked")).toBe(false);
    session.resume();
    expect(state().phase).toBe("retry");
  });

  it("keeps responses unconfirmed during pause, rechecks the cached request on resume", async () => {
    const { session, state } = setup();
    session.start(); await settled();
    session.send("Only once");
    const requestId = state().pending!.requestId;
    session.pause(); await settled();
    expect(state().turns).toHaveLength(1);
    session.resume(); await settled();
    expect(state().turns.filter(t => t.requestId === requestId)).toHaveLength(2);
    expect(state().corrections).toHaveLength(1);
  });

  it("resumes while the old request is still in flight without duplicating delivery", async () => {
    let resolve!: (reply: Reply) => void;
    let calls = 0;
    const provider: Provider = {
      respond: () => { calls++; return new Promise(r => { resolve = r; }); },
      createNote: async request => buildNote(request),
    };
    const session = new LearningSession(provider);
    session.start(); session.pause(); session.resume();
    resolve({ text: "Question?", learning: "conversation" }); await settled();
    expect(calls).toBe(1);
    expect(session.getSnapshot().turns).toHaveLength(1);
  });

  it("ignores late replies after ending, excludes the unconfirmed answer from notes", async () => {
    const { session, provider, state } = setup("conversation");
    session.start(); await settled(); session.send("Confirmed"); await settled();
    provider.delayMs = 20;
    session.send("Unconfirmed"); session.end(); session.end();
    const endedAt = state().endedAt;
    await new Promise(resolve => setTimeout(resolve, 35));
    expect(state().phase).toBe("ended");
    expect(state().endedAt).toBe(endedAt);
    expect(state().turns.some(t => t.text === "Unconfirmed")).toBe(false);
    expect(state().note!.evidence.map(e => e.text)).toEqual(["Confirmed"]);
    expect(state().metrics.some(m => m.result === "ignored")).toBe(true);
  });

  it("does not generate empty notes, including when an answer is still unconfirmed", async () => {
    const { session, state } = setup();
    session.start(); await settled(); session.send("Not confirmed"); session.end(); await settled();
    expect(state().noteStatus).toBe("empty");
    expect(state().note).toBeUndefined();
    session.resume(); expect(state().phase).toBe("ended");
  });

  it("retries only note generation after failure and deduplicates concurrent retries", async () => {
    const { session, provider, state } = setup("conversation");
    session.start(); await settled(); session.send("A real input"); await settled();
    provider.failNextNote = true;
    session.end(); await settled();
    expect(state().noteStatus).toBe("failed");
    expect(session.send("Cannot reopen")).toBe(false);
    const turns = state().turns;
    await Promise.all([session.generateNote(), session.generateNote()]);
    expect(state().noteStatus).toBe("ready");
    expect(state().turns).toBe(turns);
    expect(state().metrics.filter(m => m.event === "note")).toHaveLength(2);
    expect(markdown(state().note!)).toContain("확인된 교정이 없습니다.");
  });

  it("accepts a provider decision to continue even without a successful retry", async () => {
    const fake = new FakeProvider(); fake.delayMs = 0;
    const provider: Provider = {
      respond: request => request.learning === "retry"
        ? Promise.resolve({ text: "Let's continue. What's next?", learning: "conversation" })
        : fake.respond(request),
      createNote: request => fake.createNote(request),
    };
    const session = new LearningSession(provider);
    session.start(); await settled(); session.send("Answer"); await settled();
    session.send("Move on"); await settled();
    expect(session.getSnapshot().phase).toBe("conversation");
    expect(session.getSnapshot().corrections[0].attempts).toHaveLength(0);
  });

  it("does not put input, reply or exception text in diagnostic metadata", async () => {
    const { session, provider, state } = setup();
    session.start(); await settled();
    provider.failNextReply = true;
    session.send("PRIVATE_INPUT_secret"); await settled();
    const data = JSON.stringify(state().metrics);
    expect(data).not.toContain("PRIVATE_INPUT");
    expect(data).not.toContain("SIMULATED");
    expect(data).not.toContain("yesterday");
    expect(Object.keys(state().metrics[0]).sort()).toEqual(["elapsedMs", "event", "from", "requestId", "result", "to"]);
  });

  it("uses the actual Korean end date and rejects invented note evidence", () => {
    expect(koreaDate("2026-10-23T15:01:00Z")).toBe("2026-10-24");
    const request: NoteRequest = {
      requestId: "note", endedAt: "2026-10-23T15:01:00Z",
      turns: [{ id: "u1", requestId: "r1", role: "user", text: "Literal <script>text</script>" }], corrections: [],
    };
    const note = buildNote(request);
    expect(validateNote(note, request)).toBe(true);
    expect(markdown(note)).toContain("&lt;script&gt;");
    expect(markdown(note)).not.toContain("<script>");
    expect(validateNote({ ...note, evidence: [{ turnId: "u1", text: "Invented" }] }, request)).toBe(false);
    expect(validateNote({ ...note, evidence: [] }, request)).toBe(false);
    expect(validateNote({ ...note, items: [{ sourceTurnId: "u1", original: "Literal <script>text</script>", deliveredTurnId: "a1", replacement: "Invented", explanation: "invented", attempts: [] }] }, request)).toBe(false);
  });

  it("fails safely when a provider returns notes unrelated to the confirmed transcript", async () => {
    const fake = new FakeProvider("conversation"); fake.delayMs = 0;
    const provider: Provider = {
      respond: (request: Request) => fake.respond(request),
      createNote: async request => ({ ...buildNote(request), evidence: [{ turnId: "fake", text: "invented" }] }),
    };
    const session = new LearningSession(provider);
    session.start(); await settled(); session.send("Answer"); await settled(); session.end(); await settled();
    expect(session.getSnapshot().noteStatus).toBe("failed");
    expect(session.getSnapshot().phase).toBe("ended");
  });
});
