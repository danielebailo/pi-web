import { statSync } from "node:fs";
import type { SessionContext } from "@earendil-works/pi-coding-agent";
import { openSessionForRead } from "./session-open.ts";

/**
 * Session images, addressed by URL instead of shipped inline.
 *
 * A session file carries every picture it ever held as base64 inside the JSONL,
 * and a switch used to drag all of them through one `/messages` response — 30MB
 * on a session that screenshots a lot, parsed on the browser's main thread
 * before a single row could paint, though the reader looks at one or two of them
 * and usually not the ones at the top. The transcript now hands the **tool
 * results'** pictures out as URLs the browser fetches lazily (it already renders
 * them with `loading="lazy"`), which is where the weight is: a tool that returns
 * screenshots is what makes a session large.
 *
 * User messages keep their pictures inline on purpose. A failed turn can be
 * retried, and a retry re-sends the prompt's own images to pi — which wants the
 * base64 back. Nothing here has to know how to rehydrate for that path; the
 * bytes simply never leave the message.
 *
 * ## Addressing
 *
 * An image is named by **its position among the transcript's images**, plus the
 * session file's mtime. The position is cheap to derive and both sides agree on
 * it because both walk `buildSessionContext().messages` in the same order; the
 * mtime makes the URL change when the file does, so a response is immutable and
 * a stale ordinal can never answer for a newer file.
 *
 * The bytes are re-derived from the file on request, through the same shared
 * parse the transcript read just used (`session-open.ts`). The reader's browser
 * asks for them within a moment of the transcript arriving, so the parse is
 * still warm; a cold one costs the file read, off the critical path because by
 * then the rows are already on screen.
 *
 * A **live** session is deliberately not rewritten: its transcript comes from
 * pi's memory and may hold turns the file has never seen, which a URL could not
 * point at. See the `/messages` route.
 */

/** One image's bytes, with the type to serve them as. */
export interface SessionImage {
  mimeType: string;
  data: string;
}

/** The shape this module reads; the wire shape is wider than pi's own union. */
interface MessageLike {
  role?: unknown;
  content?: unknown;
}

function asImage(block: unknown): SessionImage | null {
  if (typeof block !== "object" || block === null) return null;
  const candidate = block as { type?: unknown; data?: unknown; mimeType?: unknown };
  if (candidate.type !== "image") return null;
  if (typeof candidate.data !== "string" || candidate.data.length === 0) return null;
  if (typeof candidate.mimeType !== "string") return null;
  return { mimeType: candidate.mimeType, data: candidate.data };
}

/** The current version of the bytes a session's images come from. */
export function sessionImageVersion(sessionPath: string): string | null {
  const stat = statSync(sessionPath, { bigint: true, throwIfNoEntry: false });
  return stat === undefined ? null : stat.mtimeNs.toString();
}

/** The URL one image is fetched from. The only place the shape is spelled. */
export function sessionImageUrl(sessionPath: string, index: number, version: string): string {
  const id = encodeURIComponent(sessionPath);
  return `/api/sessions/${id}/image/${String(index)}?v=${encodeURIComponent(version)}`;
}

/**
 * Replace every **tool result's** inline image with a URL, leaving the rest of
 * the transcript untouched.
 *
 * The image ordinal is counted across every message, not only the rewritten
 * ones, so the number in a URL is the image's place in the transcript and the
 * reader that serves it can find it by walking the same list. Copies are made
 * lazily: a message with no tool-result image is handed back as the same object,
 * and only the block arrays that actually change are rebuilt — the parsed
 * session must not be mutated, because `session-open.ts` hands the same manager
 * to the composer's read.
 */
export function withToolResultImageUrls(
  messages: SessionContext["messages"],
  sessionPath: string,
  version: string,
): SessionContext["messages"] {
  const source = messages as unknown as MessageLike[];
  let next = source;
  let index = 0;

  source.forEach((message, messageIndex) => {
    const content = message.content;
    if (!Array.isArray(content)) return;
    const toolResult = message.role === "toolResult";
    let blocks = content;

    content.forEach((block, blockIndex) => {
      if (asImage(block) === null) return;
      const at = index;
      index += 1;
      if (!toolResult) return;
      if (blocks === content) blocks = [...content];
      blocks[blockIndex] = {
        type: "image",
        mimeType: (block as { mimeType: string }).mimeType,
        url: sessionImageUrl(sessionPath, at, version),
      };
    });

    if (blocks === content) return;
    if (next === source) next = [...source];
    next[messageIndex] = { ...message, content: blocks };
  });

  return next as unknown as SessionContext["messages"];
}

/**
 * The image at `index` in a session's transcript, in document order, or null
 * when the file has no such image.
 */
export function readSessionImage(sessionPath: string, index: number): SessionImage | null {
  const manager = openSessionForRead(sessionPath);
  const messages = manager.buildSessionContext().messages as unknown as MessageLike[];
  let at = 0;

  for (const message of messages) {
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const image = asImage(block);
      if (image === null) continue;
      if (at === index) return image;
      at += 1;
    }
  }
  return null;
}
