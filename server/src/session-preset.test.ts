import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESET_ID, MINIMAL_SYSTEM_PROMPT } from "./presets.ts";
import { resetSessionOpenCache } from "./session-open.ts";
import { readSessionComposition } from "./session-preset.ts";

const HEADER = {
  type: "session",
  version: 3,
  id: "01a04228-2612-7b9a-b6f1-f5c38cc1e726",
  timestamp: "2026-01-01T00:00:00.000Z",
  cwd: "/tmp/project",
};

const systemEntry = (
  id: string,
  parentId: string | null,
  message: Record<string, unknown>,
): unknown => ({
  type: "message",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  message: { role: "system", timestamp: 1735689601000, ...message },
});

let dir: string;

async function writeSession(entries: unknown[], name = "session.jsonl"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "piws-preset-"));
  resetSessionOpenCache();
});

afterEach(async () => {
  resetSessionOpenCache();
  await rm(dir, { recursive: true, force: true });
});

describe("readSessionComposition", () => {
  it("reads the minimal composition out of the leading system message", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, { content: "", sections: { preamble: MINIMAL_SYSTEM_PROMPT } }),
    ]);
    // A recorded system message is also the lock: the session has already been
    // composed once, so the choice is no longer the caller's.
    expect(readSessionComposition(path)).toEqual({ presetId: "minimal", locked: true });
  });

  it("reads a real minimal file, runtime sections and all", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, {
        content: "",
        sections: {
          preamble: MINIMAL_SYSTEM_PROMPT,
          cwd: "<cwd>\n/private/tmp/project\n</cwd>",
        },
        toolsAdded: [{ name: "bash" }],
      }),
    ]);
    expect(readSessionComposition(path).presetId).toBe("minimal");
  });

  it("accepts the tool list when the file records no prompt sections", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, { content: "", toolsAdded: [{ name: "bash" }] }),
    ]);
    expect(readSessionComposition(path).presetId).toBe("minimal");
  });

  it("treats a full tool set as the default composition", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, {
        content: "You are a coding assistant.",
        toolsAdded: [{ name: "read" }, { name: "bash" }, { name: "edit" }, { name: "write" }],
      }),
    ]);
    expect(readSessionComposition(path).presetId).toBe(DEFAULT_PRESET_ID);
  });

  it("treats a session with no system message as the default, and still open", async () => {
    // A session pi minted but never sent a request for: there is nothing to
    // reverse, the default is what a caller would have gotten anyway, and no
    // turn exists to contradict a different composition.
    const path = await writeSession([HEADER]);
    expect(readSessionComposition(path)).toEqual({ presetId: DEFAULT_PRESET_ID, locked: false });
  });

  it("treats a missing file as the default, and still open", () => {
    expect(readSessionComposition(join(dir, "absent.jsonl"))).toEqual({
      presetId: DEFAULT_PRESET_ID,
      locked: false,
    });
  });
});
