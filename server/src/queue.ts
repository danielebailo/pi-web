/**
 * A server-side mirror of the queued messages pi holds for one session.
 *
 * pi exposes its queue only as opaque strings: `steer`/`followUp` push into an
 * internal array, `clearQueue` drains it and returns the texts, and
 * `queue_update` events report the current strings. There is no per-item
 * handle — no way to edit or drop one entry in place. dsh ships that
 * (`agent.inbox.replace/remove`); pi does not, so editing or removing a queued
 * message here means the full dance: drain the queue, rewrite the texts, and
 * push everything back.
 *
 * Images are the one thing that dance cannot preserve, because the strings
 * carry no attachments. The mirror remembers the image payloads this server
 * itself enqueued, keyed by text, so a remove can requeue the survivors with
 * their pictures and an edit keeps the untouched rows intact. Messages queued
 * from the terminal (which this server never saw) reconcile in as text-only
 * rows; editing one of those drops its images the same way dsh's editor does —
 * queue edits accept text content only.
 *
 * The mirror is advisory state, not truth: every mutation re-reads pi's queue
 * through `clearQueue` first and reconciles against what comes back, so a
 * queue that moved under us (a run settled, the terminal queued something)
 * corrects before we act on it.
 */
import type { RpcClient } from "@earendil-works/pi-coding-agent";

/** The slice of a resident session this module needs. */
export interface QueueHandle {
  sessionPath: string;
  client: RpcClient;
}

/** pi's `ImageContent`, spelled out — the RPC layer takes it structurally. */
interface QueuedImage {
  type: "image";
  data: string;
  mimeType: string;
}

/** One queued message as this module tracks it. */
export interface QueuedItem {
  text: string;
  images: QueuedImage[];
}

/** Which lane a queued message sits in — the names the client's API uses. */
export type QueueMode = "steer" | "followUp";

/** pi's own lane names, as `queue_update` and `clearQueue` spell them. */
export type QueueLane = "steering" | "followUp";

/** Both lanes for one session. */
export type SessionQueue = Record<QueueLane, QueuedItem[]>;

export interface QueueEvent {
  type: string;
  steering?: readonly string[];
  followUp?: readonly string[];
}

/** The mutation a client asked for. */
export type QueueAction =
  | { kind: "remove" }
  | { kind: "edit"; text: string };

export interface QueueMutation {
  mode: QueueMode;
  index: number;
  /** What the client believes sits at `index` — guards against a stale view. */
  expectedText: string;
  action: QueueAction;
}

export interface QueueMutationResult {
  queue: SessionQueue;
  /** Texts pi refused to take back, for the client to surface. */
  failed: string[];
}

/** An index that no longer names the message the client saw. */
export class ConflictAfterRequeue extends Error {
  constructor(readonly failed: string[]) {
    super("queued item is no longer pending");
    this.name = "ConflictAfterRequeue";
  }
}

const LANES: readonly QueueLane[] = ["steering", "followUp"];

function laneOf(mode: QueueMode): QueueLane {
  return mode === "steer" ? "steering" : "followUp";
}

/** Mirrors die with their handle; a respawned process starts with no queue. */
const mirrors = new WeakMap<QueueHandle, SessionQueue>();

function mirrorFor(handle: QueueHandle): SessionQueue {
  let mirror = mirrors.get(handle);
  if (mirror === undefined) {
    mirror = { steering: [], followUp: [] };
    mirrors.set(handle, mirror);
  }
  return mirror;
}

/**
 * Remember one message this server just handed to pi.
 *
 * Called only after the RPC resolved, so the item is really queued; the mirror
 * append is what gives a later remove/edit the images to restore.
 */
export function recordEnqueue(
  handle: QueueHandle,
  mode: QueueMode,
  text: string,
  images: QueuedImage[] | undefined,
): void {
  const mirror = mirrorFor(handle);
  mirror[laneOf(mode)].push({ text, images: images ?? [] });
}

/**
 * Reconcile the mirror with a `queue_update` report.
 *
 * pi's queue only ever grows at the tail (a message was queued) or shrinks
 * from the head (the run consumed it), so the mirror follows the same shape:
 * shorter report → entries were drained, drop from the head; longer →
 * something queued outside this server (the terminal), adopt it as text-only.
 */
export function reconcileEvent(handle: QueueHandle, event: QueueEvent): void {
  if (event.type !== "queue_update") return;
  const mirror = mirrorFor(handle);
  for (const lane of LANES) {
    const reported = event[lane];
    if (!Array.isArray(reported)) continue;
    reconcileLane(mirror[lane], reported);
  }
}

/** Apply one lane's head-shrink / tail-adopt walk against reported strings. */
function reconcileLane(laneMirror: QueuedItem[], reported: readonly string[]): void {
  while (laneMirror.length > reported.length) laneMirror.shift();
  let i = laneMirror.length;
  while (i < reported.length) {
    laneMirror.push({ text: reported[i] ?? "", images: [] });
    i += 1;
  }
}

export function parseQueueMode(value: unknown): QueueMode {
  if (value !== "steer" && value !== "followUp") {
    throw new Error("mode must be \"steer\" or \"followUp\"");
  }
  return value;
}

/**
 * Edit or remove one queued message: drain, rewrite, push back.
 *
 * The requeue keeps each item's original lane. A lane RPC that rejects (an
 * input handler or skill expansion failing on the way back in) leaves that
 * item out of pi for good — it is reported in `failed` rather than thrown, so
 * the survivors still make it back into the queue.
 */
export async function mutateQueue(
  handle: QueueHandle,
  request: QueueMutation,
): Promise<QueueMutationResult> {
  const { mode, index, expectedText, action } = request;
  const mirror = mirrorFor(handle);
  const actual = await handle.client.clearQueue();
  for (const lane of LANES) {
    reconcileLane(mirror[lane], actual[lane] ?? []);
  }

  const laneName = laneOf(mode);
  const lane = mirror[laneName];
  if (index < 0 || index >= lane.length || lane[index]?.text !== expectedText) {
    // Stale or raced: put pi's queue back exactly as it was and let the
    // client re-read. `actual` is the authoritative content; the reconciled
    // mirror is now its image-bearing view.
    const failed: string[] = [];
    await requeueAll(handle, mirror, failed);
    throw new ConflictAfterRequeue(failed);
  }

  const next: SessionQueue = {
    steering: [...mirror.steering],
    followUp: [...mirror.followUp],
  };
  if (action.kind === "remove") {
    next[laneName].splice(index, 1);
  } else {
    // dsh's editor accepts text only: the rewritten row loses its images.
    next[laneName][index] = { text: action.text, images: [] };
  }

  const failed: string[] = [];
  await requeueAll(handle, next, failed);
  mirrors.set(handle, next);
  return { queue: next, failed };
}

/** Push every mirrored item back into pi, collecting the refusals. */
async function requeueAll(handle: QueueHandle, queue: SessionQueue, failed: string[]): Promise<void> {
  for (const lane of LANES) {
    for (const item of queue[lane]) {
      try {
        const images = item.images.length > 0 ? item.images : undefined;
        if (lane === "steering") {
          await handle.client.steer(item.text, images);
        } else {
          await handle.client.followUp(item.text, images);
        }
      } catch (err) {
        failed.push(item.text);
        console.error(`[queue] requeue ${lane} failed:`, (err as Error).message);
      }
    }
  }
}
