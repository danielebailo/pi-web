import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSessionForRead, resetSessionOpenCache } from "./session-open.ts";
import { readSessionSnapshot } from "./session-reader.ts";
import { readComposerFromDisk } from "./composer.ts";

const HEADER = {
  type: "session",
  version: 3,
  id: "01a04228-2612-7b9a-b6f1-f5c38cc1e726",
  timestamp: "2026-01-01T00:00:00.000Z",
  cwd: "/tmp/project",
};

const modelChange = (id: string, parentId: string | null, provider: string, modelId: string) => ({
  type: "model_change",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:00.500Z",
  provider,
  modelId,
});

const message = (id: string, parentId: string | null, role: string, content: unknown) => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  message: { role, content },
});

/** A switch's two disk readers, pointed at one file. */
let dir: string;
const emptyCatalog = new Map();

async function writeSession(entries: unknown[]): Promise<string> {
  const path = join(dir, "session.jsonl");
  await writeFile(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "piws-open-"));
  resetSessionOpenCache();
});

afterEach(async () => {
  resetSessionOpenCache();
  await rm(dir, { recursive: true, force: true });
});

describe("openSessionForRead", () => {
  it("parses the file once across the transcript and the composer reads", async () => {
    const path = await writeSession([
      HEADER,
      modelChange("m1", null, "cz", "glm"),
      message("u1", "m1", "user", "hello"),
    ]);

    const open = vi.spyOn(SessionManager, "open");
    readSessionSnapshot(path);
    await readComposerFromDisk(path, emptyCatalog);

    // The whole point: one parse serves both.
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it("hands the same parse to a later reader of unchanged bytes", async () => {
    const path = await writeSession([HEADER, message("u1", null, "user", "hello")]);
    expect(openSessionForRead(path)).toBe(openSessionForRead(path));
  });

  it("re-parses after the file grows, so the second read sees the new turn", async () => {
    const path = await writeSession([HEADER, message("u1", null, "user", "hello")]);
    expect(readSessionSnapshot(path).messages).toHaveLength(1);

    // What pi does on the next turn: append. The size changes, so the key does.
    await writeFile(
      path,
      [
        HEADER,
        message("u1", null, "user", "hello"),
        message("a1", "u1", "assistant", [{ type: "text", text: "hi" }]),
      ]
        .map((entry) => `${JSON.stringify(entry)}\n`)
        .join(""),
      "utf8",
    );

    expect(readSessionSnapshot(path).messages).toHaveLength(2);
  });

  it("does not cache a missing file", async () => {
    const path = join(dir, "never-written.jsonl");
    const open = vi.spyOn(SessionManager, "open");
    // `open()` is pi's open-or-create path; a created file must not be handed to
    // the next reader as if it were the file that was asked for.
    openSessionForRead(path);
    openSessionForRead(path);
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });
});
