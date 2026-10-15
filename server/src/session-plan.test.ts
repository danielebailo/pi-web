import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSessionOpenCache } from "./session-open.ts";
import { PLAN_MODE_ENTRY, readSessionPlanActive, sessionPlanActive, planActiveOfEntries } from "./session-plan.ts";
import { openSessionForRead } from "./session-open.ts";

const HEADER = {
  type: "session",
  version: 3,
  id: "01a04228-2612-7b9a-b6f1-f5c38cc1e726",
  timestamp: "2026-01-01T00:00:00.000Z",
  cwd: "/tmp/project",
};

/** One `custom` entry, the shape `pi.appendEntry()` writes. */
const planEntry = (id: string, parentId: string | null, data: unknown): unknown => ({
  type: "custom",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  customType: PLAN_MODE_ENTRY,
  data,
});

/** One entry from a different extension, to prove the scan is namespaced. */
const otherEntry = (id: string, parentId: string | null): unknown => ({
  type: "custom",
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  customType: "my-extension",
  data: { active: true },
});

let dir: string;

async function writeSession(entries: unknown[], name = "session.jsonl"): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "piws-plan-"));
  resetSessionOpenCache();
});

afterEach(async () => {
  resetSessionOpenCache();
  await rm(dir, { recursive: true, force: true });
});

describe("readSessionPlanActive", () => {
  it("reads the newest transition as the state", async () => {
    const path = await writeSession([
      HEADER,
      planEntry("p1", null, { active: true }),
      planEntry("p2", "p1", { active: false }),
      planEntry("p3", "p2", { active: true }),
    ]);
    expect(readSessionPlanActive(path)).toBe(true);
  });

  it("treats a session with no plan entry as inactive", async () => {
    const path = await writeSession([HEADER]);
    expect(readSessionPlanActive(path)).toBe(false);
  });

  it("treats a missing file as inactive", () => {
    expect(readSessionPlanActive(join(dir, "absent.jsonl"))).toBe(false);
  });

  it("ignores another extension's entries, even with a matching payload", async () => {
    const path = await writeSession([HEADER, otherEntry("o1", null)]);
    expect(readSessionPlanActive(path)).toBe(false);
  });

  it("skips an unreadable payload instead of letting it hide the transition behind it", async () => {
    const path = await writeSession([
      HEADER,
      planEntry("p1", null, { active: true }),
      planEntry("p2", "p1", { active: "yes" }),
    ]);
    // The bad entry is not a state, so the newest *readable* one still wins —
    // unlike a fold that would stop at the first entry it cannot parse.
    expect(readSessionPlanActive(path)).toBe(true);
  });

  it("folds the branch, not every entry in the file", async () => {
    // Two siblings under the same parent: pi's branch walk follows the leaf, so
    // only the branch that is actually open counts. `p2` (false) is the leaf's
    // ancestor and `p1` (true) hangs off to the side.
    const path = await writeSession([
      HEADER,
      planEntry("root", null, { active: false }),
      planEntry("p1", "root", { active: true }),
      planEntry("p2", "root", { active: false }),
    ]);
    expect(sessionPlanActive(openSessionForRead(path))).toBe(false);
  });
});

/**
 * The RPC form of the same fold.
 *
 * It exists because the file lags the process: pi writes a session lazily, so a
 * switch made before the first message is only in memory. `get_entries` answers
 * from there — and answers with every branch, which is why this walks to the
 * leaf instead of scanning for the newest entry anywhere in the list.
 */
describe("planActiveOfEntries", () => {
  const entry = (id: string, parentId: string | null, data: unknown): unknown => ({
    type: "custom",
    id,
    parentId,
    customType: PLAN_MODE_ENTRY,
    data,
  });

  it("reads the newest transition on the branch that ends at the leaf", () => {
    const entries = [
      entry("root", null, { active: false }),
      entry("p1", "root", { active: true }),
      entry("p2", "p1", { active: false }),
      entry("p3", "p2", { active: true }),
    ] as Parameters<typeof planActiveOfEntries>[0];

    expect(planActiveOfEntries(entries, "p3")).toBe(true);
    expect(planActiveOfEntries(entries, "p2")).toBe(false);
  });

  it("ignores a sibling branch's newer entry", () => {
    // `p2` is newer in append order but hangs off `root`, while the leaf sits on
    // `p1`; a scan for the newest entry anywhere would answer true here.
    const entries = [
      entry("root", null, { active: false }),
      entry("p1", "root", { active: true }),
      entry("p2", "root", { active: false }),
    ] as Parameters<typeof planActiveOfEntries>[0];

    expect(planActiveOfEntries(entries, "p1")).toBe(true);
  });

  it("answers off for an empty session or a leaf that is not in the list", () => {
    expect(planActiveOfEntries([], null)).toBe(false);
    expect(planActiveOfEntries([], "missing")).toBe(false);
  });
});
