import { describe, expect, it } from "vitest";
import {
  buildRows,
  CHAT_DIFF_MAX_LINES,
  contentLines,
  copyText,
  diffCardModel,
  diffTotals,
  localHunks,
} from "./diff-card-model.ts";

describe("diffCardModel", () => {
  it("derives a whole-file diff from a write's arguments", () => {
    expect(diffCardModel("write", { path: "a.ts", content: "hi\n" }, false)).toEqual({
      diffs: [{ path: "a.ts", oldText: null, newText: "hi\n" }],
    });
  });

  it("derives one hunk per pi edit entry", () => {
    expect(
      diffCardModel(
        "edit",
        {
          path: "a.ts",
          edits: [
            { oldText: "alpha", newText: "beta" },
            { oldText: "one\ntwo", newText: "one\nTWO" },
          ],
        },
        false,
      ),
    ).toEqual({
      diffs: [
        { path: "a.ts", oldText: "alpha", newText: "beta" },
        { path: "a.ts", oldText: "one\ntwo", newText: "one\nTWO" },
      ],
    });
  });

  it("refuses partial or foreign arguments and errored calls", () => {
    expect(diffCardModel("write", { path: "a.ts" }, false)).toBeNull(); // content still streaming
    expect(diffCardModel("write", undefined, false)).toBeNull();
    expect(diffCardModel("edit", { path: "a.ts", edits: [] }, false)).toBeNull();
    expect(diffCardModel("edit", { path: "a.ts", edits: [{ oldText: "a" }] }, false)).toBeNull();
    expect(diffCardModel("bash", { command: "ls" }, false)).toBeNull();
    expect(diffCardModel("write", { path: "a.ts", content: "hi" }, true)).toBeNull();
    expect(diffCardModel("write", { content: "no path" }, false)).toBeNull();
  });
});

describe("contentLines", () => {
  it("treats a trailing newline as a terminator, not an extra line", () => {
    expect(contentLines("a\nb\n")).toEqual(["a", "b"]);
    expect(contentLines("a\nb")).toEqual(["a", "b"]);
    expect(contentLines("")).toEqual([]);
    expect(contentLines("\n")).toEqual([""]);
  });
});

describe("localHunks", () => {
  it("keeps three context lines around a change", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const [hunk] = localHunks({ path: "f", oldText: text, newText: text.replace("line 10", "LINE 10") });
    expect(hunk?.lines[0]).toBe(" line 7");
    expect(hunk?.lines).toContain("-line 10");
    expect(hunk?.lines).toContain("+LINE 10");
    expect(hunk?.lines.at(-1)).toBe(" line 13");
  });

  it("falls back to a whole-fragment replacement beyond the edit limit", () => {
    // Every line changes, so the edit graph's cost (300) blows past the bound
    // and the whole fragment renders as one wholesale replacement.
    const oldText = Array.from({ length: 300 }, (_, i) => `old ${i}`).join("\n");
    const newText = Array.from({ length: 300 }, (_, i) => `new ${i}`).join("\n");
    const hunks = localHunks({ path: "f", oldText, newText });
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines.filter((l) => l.startsWith("-"))).toHaveLength(300);
    expect(hunks[0]?.lines.filter((l) => l.startsWith("+"))).toHaveLength(300);
  });
});

describe("buildRows", () => {
  it("opens with a path header and separates same-file hunks with gaps", () => {
    const rows = buildRows([
      { path: "a.ts", oldText: "x", newText: "y" },
      { path: "a.ts", oldText: "p", newText: "q" },
    ]);
    expect(rows[0]).toEqual({ kind: "path", text: "a.ts" });
    expect(rows.some((row) => row.kind === "gap" && row.text === "⋯")).toBe(true);
    expect(rows.filter((row) => row.kind === "path")).toHaveLength(1);
  });

  it("re-opens the header when the path changes", () => {
    const rows = buildRows([
      { path: "a.ts", oldText: "x", newText: "y" },
      { path: "b.ts", oldText: null, newText: "new" },
    ]);
    expect(rows.filter((row) => row.kind === "path").map((row) => row.text)).toEqual(["a.ts", "b.ts"]);
  });

  it("renders a create as pure additions", () => {
    const rows = buildRows([{ path: "new.ts", oldText: null, newText: "hello\n" }]);
    expect(rows).toEqual([
      { kind: "path", text: "new.ts" },
      { kind: "add", text: "hello" },
    ]);
  });
});

describe("diffTotals", () => {
  it("counts changes but not shared context", () => {
    expect(diffTotals([{ path: "f", oldText: "keep\nold", newText: "keep\nnew" }])).toEqual({
      added: 1,
      removed: 1,
    });
  });
});

describe("copyText", () => {
  it("prefixes rows and keeps folded content", () => {
    const text = copyText(buildRows([{ path: "f", oldText: "a\nb", newText: "a\nc" }]));
    expect(text.split("\n")).toEqual(["f", "  a", "- b", "+ c"]);
  });
});

describe("CHAT_DIFF_MAX_LINES", () => {
  it("stays at dsh's chat cap", () => {
    expect(CHAT_DIFF_MAX_LINES).toBe(9);
  });
});
