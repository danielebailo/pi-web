import { describe, expect, it } from "vitest";
import type { ContentBlock, ToolResultMessage } from "../../lib/types.ts";
import { resolveTurnRef, turnRefPaths } from "./turn-refs.ts";

function call(name: string, arguments_: Record<string, unknown>, id = `${name}-1`): ContentBlock {
  return { type: "toolCall", id, name, arguments: arguments_ };
}

function resultOf(id: string, toolName: string, isError = false): ToolResultMessage {
  return { role: "toolResult", toolCallId: id, toolName, content: [], isError, timestamp: 0 };
}

const CWD = "/Users/dev/proj";

describe("turnRefPaths", () => {
  it("keeps a read as a mention", () => {
    const paths = turnRefPaths([call("read", { path: `${CWD}/src/a.ts` })], { cwd: CWD });
    expect(paths).toEqual([{ open: "src/a.ts", raw: `${CWD}/src/a.ts`, changed: false }]);
  });

  it("marks a successful write as changed and an errored one as not", () => {
    const paths = turnRefPaths(
      [
        call("write", { path: `${CWD}/src/a.ts`, content: "x" }, "w1"),
        call("edit", { path: `${CWD}/src/b.ts`, edits: [] }, "e1"),
      ],
      { cwd: CWD },
      { w1: resultOf("w1", "write"), e1: resultOf("e1", "edit", true) },
    );
    expect(paths.map((path) => [path.open, path.changed])).toEqual([
      ["src/a.ts", true],
      ["src/b.ts", false],
    ]);
  });

  it("folds two mentions of one file, letting the write win", () => {
    const paths = turnRefPaths(
      [call("read", { path: "src/a.ts" }, "r1"), call("write", { path: `${CWD}/src/a.ts`, content: "x" }, "w1")],
      { cwd: CWD },
      { w1: resultOf("w1", "write") },
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]?.changed).toBe(true);
  });

  it("keeps a path outside the project under the tool's own spelling", () => {
    const paths = turnRefPaths([call("read", { path: "/tmp/notes.md" })], { cwd: CWD });
    expect(paths).toEqual([{ open: "/tmp/notes.md", raw: "/tmp/notes.md", changed: false }]);
  });

  it("accepts the snake_case spelling some tools use", () => {
    expect(turnRefPaths([call("read", { file_path: "src/a.ts" })], { cwd: CWD })[0]?.open).toBe("src/a.ts");
  });

  it.each([
    ["bash", { command: "cat src/a.ts" }],
    ["grep", { pattern: "a", query: "a" }],
    ["write", {}],
  ])("ignores a %s call that names no file", (name, args) => {
    expect(turnRefPaths([call(name, args)], { cwd: CWD })).toEqual([]);
  });

  it("ignores blocks that are not tool calls", () => {
    expect(turnRefPaths([{ type: "text", text: "see src/a.ts" }], { cwd: CWD })).toEqual([]);
  });
});

describe("resolveTurnRef", () => {
  const paths = [
    { open: "src/a.ts", raw: "/Users/dev/proj/src/a.ts", changed: false },
    { open: "src/b.ts", raw: "/Users/dev/proj/src/b.ts", changed: true },
    { open: "other/a.ts", raw: "/Users/dev/proj/other/a.ts", changed: false },
  ];

  it("resolves an exact relative path", () => {
    expect(resolveTurnRef(paths, "src/b.ts")).toBe("src/b.ts");
  });

  it("resolves the absolute spelling a tool call used", () => {
    expect(resolveTurnRef(paths, "/Users/dev/proj/src/b.ts")).toBe("src/b.ts");
  });

  it("refuses a basename two files share", () => {
    expect(resolveTurnRef(paths, "a.ts")).toBeUndefined();
  });

  it("resolves a basename exactly one file has", () => {
    expect(resolveTurnRef(paths, "b.ts")).toBe("src/b.ts");
  });

  it("refuses a file the turn never named", () => {
    expect(resolveTurnRef(paths, "src/missing.ts")).toBeUndefined();
  });

  it("prefers the file the turn wrote when two spellings point at it", () => {
    const both = [
      { open: "src/a.ts", raw: "src/a.ts", changed: false },
      { open: "src/a.ts", raw: "/proj/src/a.ts", changed: true },
    ];
    expect(resolveTurnRef(both, "src/a.ts")).toBe("src/a.ts");
  });
});
