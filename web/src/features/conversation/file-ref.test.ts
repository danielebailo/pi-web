import { describe, expect, it } from "vitest";
import { basename, fileRefLabel, fileRefTitle, parseFileTarget, parsePathToken } from "./file-ref.ts";

describe("parseFileTarget", () => {
  it("takes a plain relative path with no line", () => {
    expect(parseFileTarget("src/index.ts")).toEqual({ path: "src/index.ts" });
  });

  it("takes a GitHub-style single line", () => {
    expect(parseFileTarget("/workspace/src/index.ts#L24")).toEqual({
      path: "/workspace/src/index.ts",
      line: 24,
      endLine: 24,
    });
  });

  it("takes a GitHub-style range and decodes its escapes", () => {
    expect(parseFileTarget("../docs/My%20Notes.md#L24-L30")).toEqual({
      path: "../docs/My Notes.md",
      line: 24,
      endLine: 30,
    });
  });

  it("keeps Windows drive letters, forward and back slashed", () => {
    expect(parseFileTarget("C:/work/file.ts#L2")).toEqual({ path: "C:/work/file.ts", line: 2, endLine: 2 });
    expect(parseFileTarget("C:%5Cwork%5Cfile.ts")).toEqual({ path: "C:\\work\\file.ts" });
  });

  it("decodes non-ASCII and escaped separators", () => {
    expect(parseFileTarget("docs/%E4%B8%AD%E6%96%87.md")).toEqual({ path: "docs/中文.md" });
    expect(parseFileTarget("file%23name%3F.txt")).toEqual({ path: "file#name?.txt" });
  });

  it("folds a leading dot-slash, because a path is matched against a turn's", () => {
    expect(parseFileTarget("./src/a.ts")).toEqual({ path: "src/a.ts" });
    expect(parseFileTarget("./src/a.ts#L2")).toEqual({ path: "src/a.ts", line: 2, endLine: 2 });
  });

  it("keeps a parent-relative path as it is spelled", () => {
    expect(parseFileTarget("../docs/a.md")).toEqual({ path: "../docs/a.md" });
  });

  it.each([
    ["https://example.com/a.ts", "an absolute URL"],
    ["javascript:alert(1)", "a script URL"],
    ["javascript%3Aalert(1)", "a percent-encoded script URL"],
    ["//host/share/a.ts", "a protocol-relative path"],
    ["src/a.ts?plain=1", "a query"],
    ["src/a.ts#L0", "line zero"],
    ["src/a.ts#L30-L24", "a reversed range"],
    ["src/a.ts#24", "a bare line number"],
    ["src/a.ts#Lx", "a non-numeric line"],
    ["src/%zz.ts", "a malformed escape"],
  ])("refuses %s (%s)", (value) => {
    expect(parseFileTarget(value)).toBeUndefined();
  });

  it("caps a range the reader could never use", () => {
    expect(parseFileTarget("src/a.ts#L1-L99999")).toEqual({ path: "src/a.ts", line: 1, endLine: 501 });
  });
});

describe("parsePathToken", () => {
  it("takes a project-relative path", () => {
    expect(parsePathToken("src/app.ts")).toEqual({ path: "src/app.ts" });
  });

  it("takes a basename with an extension", () => {
    expect(parsePathToken("README.md")).toEqual({ path: "README.md" });
  });

  it("takes a colon line and a colon range", () => {
    expect(parsePathToken("src/app.ts:24")).toEqual({ path: "src/app.ts", line: 24, endLine: 24 });
    expect(parsePathToken("src/app.ts:24-30")).toEqual({ path: "src/app.ts", line: 24, endLine: 30 });
  });

  it("takes the fragment form an agent copies from a URL", () => {
    expect(parsePathToken("src/app.ts#L7")).toEqual({ path: "src/app.ts", line: 7, endLine: 7 });
  });

  it("reads the line from the last colon, so a drive letter survives", () => {
    expect(parsePathToken("C:/work/file.ts:12")).toEqual({ path: "C:/work/file.ts", line: 12, endLine: 12 });
  });

  it("folds a leading dot-slash", () => {
    expect(parsePathToken("./src/a.ts:3")).toEqual({ path: "src/a.ts", line: 3, endLine: 3 });
  });

  it.each([
    ["length", "a bare word"],
    ["foo", "a word with no separator or extension"],
    // A colon starts a URL scheme everywhere but a Windows drive, and a token
    // that says `weird:file.txt` is far more likely to be a link than a file.
    ["weird:file.txt", "a scheme-shaped word"],
    ["npm run build", "a command with spaces"],
    ["const x = 1", "code"],
    ["https://example.com/a.ts", "a URL"],
    ["  src/a.ts", "padded code"],
    ["src/", "a folder"],
  ])("refuses %s (%s)", (token) => {
    expect(parsePathToken(token)).toBeUndefined();
  });
});

describe("labels", () => {
  it("names a single-line chip after its basename and line", () => {
    expect(fileRefLabel({ path: "src/features/a.ts", line: 24, endLine: 24 })).toBe("a.ts:24");
  });

  it("uses an en dash for a range", () => {
    expect(fileRefLabel({ path: "src/a.ts", line: 24, endLine: 30 })).toBe("a.ts:24–30");
  });

  it("drops the lines when the reference has none", () => {
    expect(fileRefLabel({ path: "src/a.ts" })).toBe("a.ts");
  });

  it("keeps the whole path in the title, with an ASCII range", () => {
    expect(fileRefTitle({ path: "src/features/a.ts", line: 24, endLine: 30 })).toBe("src/features/a.ts:24-30");
    expect(fileRefTitle({ path: "src/a.ts" })).toBe("src/a.ts");
  });

  it("splits either separator when naming a file", () => {
    expect(basename("C:\\work\\file.ts")).toBe("file.ts");
  });
});
