import { describe, expect, it } from "vitest";
import type { RpcClient } from "@earendil-works/pi-coding-agent";
import {
  ConflictAfterRequeue,
  mutateQueue,
  parseQueueMode,
  reconcileEvent,
  recordEnqueue,
  type QueueHandle,
  type QueueLane,
} from "./queue.ts";

const images = [{ type: "image", data: "AAAA", mimeType: "image/png" }] as const;

/**
 * A client that behaves like pi's queue: `steer`/`followUp` append to their
 * lane, `clearQueue` drains both and returns the texts. The calls are recorded
 * so a test can assert what was pushed back, and a scripted rejection makes a
 * requeue failure observable.
 */
function fakeClient(lanes: Record<QueueLane, string[]> = { steering: [], followUp: [] }) {
  const rejected = new Set<string>();
  const calls: Array<{ method: string; text: string }> = [];
  const client = {
    steer: async (text: string): Promise<void> => {
      // The attempt is recorded even when pi refuses it, so a test can tell
      // "never attempted" from "attempted and refused".
      calls.push({ method: "steer", text });
      if (rejected.has(text)) throw new Error("rejected by input handler");
      lanes.steering.push(text);
    },
    followUp: async (text: string): Promise<void> => {
      calls.push({ method: "followUp", text });
      if (rejected.has(text)) throw new Error("rejected by input handler");
      lanes.followUp.push(text);
    },
    clearQueue: async () => {
      const snapshot = { steering: [...lanes.steering], followUp: [...lanes.followUp] };
      lanes.steering.length = 0;
      lanes.followUp.length = 0;
      return snapshot;
    },
  };
  return { client, lanes, calls, rejected };
}

function handleOf(fake: ReturnType<typeof fakeClient>): QueueHandle {
  // The fake implements the three calls queue.ts makes and nothing else; the
  // full RpcClient surface is irrelevant to this module (composer.test.ts casts
  // the same way).
  return { sessionPath: "/tmp/queue.jsonl", client: fake.client as unknown as RpcClient };
}

/**
 * Simulate the web-send path: the RPC reached pi (the lane grew) and the
 * server recorded what it sent (the mirror knows the images).
 */
function enqueue(
  fake: ReturnType<typeof fakeClient>,
  handle: QueueHandle,
  mode: "steer" | "followUp",
  text: string,
  itemImages?: readonly { type: "image"; data: string; mimeType: string }[],
): void {
  fake.lanes[mode === "steer" ? "steering" : "followUp"].push(text);
  recordEnqueue(handle, mode, text, itemImages ? [...itemImages] : []);
}

describe("parseQueueMode", () => {
  it("accepts exactly the two lane names the API speaks", () => {
    expect(parseQueueMode("steer")).toBe("steer");
    expect(parseQueueMode("followUp")).toBe("followUp");
    expect(() => parseQueueMode("prompt")).toThrow();
    expect(() => parseQueueMode(undefined)).toThrow();
  });
});

describe("recordEnqueue + reconcileEvent", () => {
  it("keeps the survivors' image payloads across a head drain pi reports text-only", async () => {
    const fake = fakeClient();
    const handle = handleOf(fake);
    enqueue(fake, handle, "steer", "drained", images);
    enqueue(fake, handle, "steer", "middle", images);
    enqueue(fake, handle, "steer", "tail", []);

    // pi consumed the head; its queue_update only knows the texts.
    fake.lanes.steering.shift();
    reconcileEvent(handle, { type: "queue_update", steering: ["middle", "tail"], followUp: [] });

    const { queue } = await mutateQueue(handle, {
      mode: "steer",
      index: 1,
      expectedText: "tail",
      action: { kind: "remove" },
    });
    // The drained item is gone from the mirror, but the survivor keeps the
    // images this server recorded for it, and only it goes back to pi.
    expect(queue.steering.map((item) => item.text)).toEqual(["middle"]);
    expect(queue.steering[0]?.images).toEqual(images);
    expect(fake.calls).toEqual([{ method: "steer", text: "middle" }]);
  });

  it("adopts a terminal-side enqueue as a text-only row", async () => {
    const fake = fakeClient();
    const handle = handleOf(fake);
    // The terminal queued straight into pi; this server never saw it.
    fake.lanes.steering.push("from terminal");
    reconcileEvent(handle, { type: "queue_update", steering: ["from terminal"], followUp: [] });

    const { queue } = await mutateQueue(handle, {
      mode: "steer",
      index: 0,
      expectedText: "from terminal",
      action: { kind: "edit", text: "fixed" },
    });
    expect(queue.steering).toEqual([{ text: "fixed", images: [] }]);
    expect(fake.calls).toEqual([{ method: "steer", text: "fixed" }]);
  });

  it("ignores frames that are not queue reports", () => {
    const handle = handleOf(fakeClient());
    expect(() => reconcileEvent(handle, { type: "agent_start" })).not.toThrow();
  });
});

describe("mutateQueue", () => {
  it("removes one item and pushes the survivors back with their images", async () => {
    const fake = fakeClient();
    const handle = handleOf(fake);
    enqueue(fake, handle, "steer", "first", images);
    enqueue(fake, handle, "steer", "second", images);
    enqueue(fake, handle, "followUp", "third", []);

    const { queue, failed } = await mutateQueue(handle, {
      mode: "steer",
      index: 0,
      expectedText: "first",
      action: { kind: "remove" },
    });

    expect(failed).toEqual([]);
    expect(queue.steering.map((item) => item.text)).toEqual(["second"]);
    expect(queue.steering[0]?.images).toEqual(images);
    expect(queue.followUp.map((item) => item.text)).toEqual(["third"]);
    // Back into pi: the two survivors in their own lanes.
    expect(fake.calls).toEqual([
      { method: "steer", text: "second" },
      { method: "followUp", text: "third" },
    ]);
  });

  it("edits the text and drops the edited row's images", async () => {
    const fake = fakeClient();
    const handle = handleOf(fake);
    enqueue(fake, handle, "followUp", "typo here", images);

    const { queue } = await mutateQueue(handle, {
      mode: "followUp",
      index: 0,
      expectedText: "typo here",
      action: { kind: "edit", text: "fixed" },
    });

    expect(queue.followUp).toEqual([{ text: "fixed", images: [] }]);
    expect(fake.calls).toEqual([{ method: "followUp", text: "fixed" }]);
  });

  it("restores the queue untouched and reports a conflict on a stale view", async () => {
    const fake = fakeClient();
    const handle = handleOf(fake);
    enqueue(fake, handle, "steer", "real text", []);

    const promise = mutateQueue(handle, {
      mode: "steer",
      index: 0,
      expectedText: "what the client saw",
      action: { kind: "remove" },
    });

    await expect(promise).rejects.toBeInstanceOf(ConflictAfterRequeue);
    // The drain-and-fail left pi exactly as it found it.
    expect(fake.calls).toEqual([{ method: "steer", text: "real text" }]);
  });

  it("collects a requeue refusal and keeps pushing the survivors", async () => {
    const fake = fakeClient();
    fake.rejected.add("doomed");
    const handle = handleOf(fake);
    enqueue(fake, handle, "steer", "doomed", []);
    enqueue(fake, handle, "steer", "fine", []);

    const { failed } = await mutateQueue(handle, {
      mode: "steer",
      index: 1,
      expectedText: "fine",
      action: { kind: "remove" },
    });

    expect(failed).toEqual(["doomed"]);
    expect(fake.calls).toEqual([{ method: "steer", text: "doomed" }]);
  });
});
