import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESET_ID, MINIMAL_SYSTEM_PROMPT } from "./presets.ts";
import { resetSessionOpenCache } from "./session-open.ts";
import { readSessionPreset } from "./session-preset.ts";

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

describe("readSessionPreset", () => {
  it("reads the minimal composition out of the leading system message", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, { content: "", sections: { preamble: MINIMAL_SYSTEM_PROMPT } }),
    ]);
    expect(readSessionPreset(path)).toBe("minimal");
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
    expect(readSessionPreset(path)).toBe("minimal");
  });

  it("accepts the tool list when the file records no prompt sections", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, { content: "", toolsAdded: [{ name: "bash" }] }),
    ]);
    expect(readSessionPreset(path)).toBe("minimal");
  });

  it("treats a full tool set as the default composition", async () => {
    const path = await writeSession([
      HEADER,
      systemEntry("s1", null, {
        content: "You are a coding assistant.",
        toolsAdded: [{ name: "read" }, { name: "bash" }, { name: "edit" }, { name: "write" }],
      }),
    ]);
    expect(readSessionPreset(path)).toBe(DEFAULT_PRESET_ID);
  });

  it("treats a session with no system message as the default", async () => {
    // A session pi minted but never sent a request for: there is nothing to
    // reverse, and the default is what a caller would have gotten anyway.
    const path = await writeSession([HEADER]);
    expect(readSessionPreset(path)).toBe(DEFAULT_PRESET_ID);
  });

  it("treats a missing file as the default", () => {
    expect(readSessionPreset(join(dir, "absent.jsonl"))).toBe(DEFAULT_PRESET_ID);
  });
});
