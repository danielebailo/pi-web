import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStore, DRAFT_PREFIX, resetAppState } from "./app-state.ts";
import { connectEvents, setEventSession } from "./sse.ts";

/**
 * The stream with its socket cut off: `connectEvents` registers its listeners on
 * an `EventSource` that never opens, and the test calls them with the frames it
 * wants to deliver. Node has no `EventSource`, which is why this stands in.
 */
const listeners = new Map<string, (raw: MessageEvent) => void>();

class FakeEventSource {
  addEventListener(type: string, listener: (raw: MessageEvent) => void): void {
    listeners.set(type, listener);
  }
  close(): void {}
}

/** Deliver one frame the way the browser's `EventSource` would. */
function emit(type: string, payload: unknown): void {
  const listener = listeners.get(type);
  if (listener === undefined) throw new Error(`nothing listens for ${type}`);
  listener({ data: JSON.stringify(payload) } as MessageEvent);
}

/** A `notify` from an extension running in `sessionPath`. */
function notify(sessionPath: string, message: string): void {
  emit("session_event", {
    sessionPath,
    event: { type: "extension_ui_request", method: "notify", message },
  });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  resetAppState();
  listeners.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("extension notices", () => {
  it("raises the notice from the session on screen", () => {
    connectEvents();
    setEventSession("/sessions/one.jsonl");
    notify("/sessions/one.jsonl", "build finished");
    expect(appStore.get().notice).toBe("build finished");
  });

  it("drops the notice from a session that is not on screen", () => {
    connectEvents();
    setEventSession("/sessions/one.jsonl");
    notify("/sessions/two.jsonl", "build finished");
    // The frame still reaches this tab — the server treats a notice as shared
    // chrome — so nothing but the guard keeps another session's toast away.
    expect(appStore.get().notice).toBeNull();
  });

  it("drops a notice addressed elsewhere when no session is open", () => {
    connectEvents();
    setEventSession(null);
    notify("/sessions/one.jsonl", "build finished");
    expect(appStore.get().notice).toBeNull();
  });

  it("reads an unaddressed notice as the seat that is becoming a session", () => {
    connectEvents();
    setEventSession(null); // The hero: its next message creates a session.
    notify("", "build finished");
    expect(appStore.get().notice).toBe("build finished");
  });

  it("reads an unaddressed notice as the draft on screen", () => {
    connectEvents();
    setEventSession(`${DRAFT_PREFIX}local-1`);
    // A session being created has no file yet, so its extension's frames come
    // out addressed to nobody while the draft is what this tab is reading.
    notify("", "build finished");
    expect(appStore.get().notice).toBe("build finished");

    appStore.update((state) => ({ ...state, notice: null }));
    notify("/sessions/one.jsonl", "build finished");
    expect(appStore.get().notice).toBeNull();
  });

  it("keeps a notice before the shell has declared a session", async () => {
    // Fresh modules: this one has never called `setEventSession`, so nothing can
    // be judged foreign yet and the notice is not dropped on a guess.
    vi.resetModules();
    const freshState = await import("./app-state.ts");
    const freshSse = await import("./sse.ts");
    freshSse.connectEvents();
    notify("/sessions/two.jsonl", "build finished");
    expect(freshState.appStore.get().notice).toBe("build finished");
  });
});
