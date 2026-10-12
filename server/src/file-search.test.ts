import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expandGitPaths,
  matchScore,
  rankEntries,
  resetFileIndexCache,
  searchWorkspaceFiles,
  type FileSearchEntry,
} from "./file-search.ts";

/** Whether a real git is on PATH; the repository tests need one. */
const gitAvailable = ((): boolean => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const entry = (path: string, type: FileSearchEntry["type"] = "file"): FileSearchEntry => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  type,
});

describe("expandGitPaths", () => {
  it("turns NUL-separated paths into files plus their ancestors", () => {
    const entries = expandGitPaths("src/lib/api.ts\0README.md\0");
    const paths = entries.map((item) => item.path).sort();
    expect(paths).toEqual(["README.md", "src", "src/lib", "src/lib/api.ts"]);
    expect(entries.find((item) => item.path === "src/lib")?.type).toBe("directory");
    expect(entries.find((item) => item.path === "src/lib/api.ts")?.name).toBe("api.ts");
  });

  it("derives a shared ancestor once", () => {
    const entries = expandGitPaths("src/a.ts\0src/b.ts\0");
    expect(entries.filter((item) => item.path === "src")).toHaveLength(1);
  });

  it("drops paths that would escape the root", () => {
    const entries = expandGitPaths("../outside.ts\0/src.ts\0./inside.ts\0");
    expect(entries.map((item) => item.path)).toEqual(["inside.ts"]);
  });

  it("reads an empty repository as no entries", () => {
    expect(expandGitPaths("\0")).toEqual([]);
  });
});

describe("matchScore", () => {
  it("ranks a name prefix above a name substring", () => {
    const prefix = matchScore("src/useComposerState.ts", "useComposer");
    const inside = matchScore("src/useComposerState.ts", "Composer");
    expect(prefix).not.toBeNull();
    expect(inside).not.toBeNull();
    expect(prefix!).toBeGreaterThan(inside!);
  });

  it("ranks a name match above a directory-only match", () => {
    const name = matchScore("src/api.ts", "api");
    const directory = matchScore("api/handlers/deep.ts", "api");
    expect(name!).toBeGreaterThan(directory!);
  });

  it("gives the same name a place in the same band whatever its directory", () => {
    // The name is what the query reached, so the directory around it is not a
    // reason to rank one above the other; `rankEntries` breaks that tie on
    // depth, which is where "shallow first" belongs.
    expect(matchScore("api.ts", "api")).toBe(matchScore("server/src/lib/deep/api.ts", "api"));
  });

  it("falls back to a scattered subsequence", () => {
    expect(matchScore("src/useComposerState.ts", "ucs")).not.toBeNull();
  });

  it("does not match characters that are out of order", () => {
    expect(matchScore("src/api.ts", "ipta")).toBeNull();
  });

  it("treats an empty query as matching everything", () => {
    expect(matchScore("anything.txt", "")).toBe(0);
  });

  it("matches a query containing a separator against the whole path", () => {
    expect(matchScore("src/lib/api.ts", "src/lib")).not.toBeNull();
  });
});

describe("rankEntries", () => {
  const entries = [
    entry("src/api.ts"),
    entry("api"),
    entry("server/src/lib/deep/api.ts"),
    entry("docs/guide.md"),
  ];

  it("puts directories ahead of files on a tie", () => {
    const { items } = rankEntries([entry("api.ts"), entry("api", "directory")], "", 10);
    expect(items[0]?.type).toBe("directory");
  });

  it("prefers the shallowest of two equal matches", () => {
    const { items } = rankEntries(entries, "api", 10);
    expect(items.map((item) => item.path)).toEqual([
      "api",
      "src/api.ts",
      "server/src/lib/deep/api.ts",
    ]);
  });

  it("cuts the list at the limit and says so", () => {
    const { items, truncated } = rankEntries(entries, "api", 1);
    expect(items).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it("reports no truncation when everything fits", () => {
    const { items, truncated } = rankEntries(entries, "guide", 10);
    expect(items.map((item) => item.path)).toEqual(["docs/guide.md"]);
    expect(truncated).toBe(false);
  });

  it("drops entries that do not match", () => {
    expect(rankEntries(entries, "zzz", 10).items).toEqual([]);
  });
});

describe("searchWorkspaceFiles", () => {
  let root: string;

  beforeEach(async () => {
    resetFileIndexCache();
    root = await mkdtemp(join(tmpdir(), "pi-web-files-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("walks a directory git does not know about", async () => {
    await mkdir(join(root, "src/lib"), { recursive: true });
    await mkdir(join(root, "node_modules/pkg"), { recursive: true });
    await writeFile(join(root, "src/lib/api.ts"), "");
    await writeFile(join(root, "README.md"), "");
    await writeFile(join(root, "node_modules/pkg/index.js"), "");

    const found = await searchWorkspaceFiles(root, "api");
    expect(found.items.map((item) => item.path)).toContain("src/lib/api.ts");

    const everything = await searchWorkspaceFiles(root, "", 100);
    const paths = everything.items.map((item) => item.path);
    expect(paths).toContain("src");
    expect(paths).toContain("README.md");
    // Dependencies are noise in a menu that exists to name the user's own files.
    expect(paths.some((path) => path.startsWith("node_modules"))).toBe(false);
  });

  it("reuses an index within the TTL", async () => {
    await writeFile(join(root, "only.ts"), "");
    const first = await searchWorkspaceFiles(root, "only");
    await writeFile(join(root, "later.ts"), "");
    const second = await searchWorkspaceFiles(root, "later");
    // The freshly written file is not in the cached index yet.
    expect(second.items).toEqual([]);
    expect(first.items[0]?.path).toBe("only.ts");
  });

  it("reports how large the index is, not just what matched", async () => {
    await writeFile(join(root, "one.ts"), "");
    const found = await searchWorkspaceFiles(root, "nothinglikethis");
    expect(found.items).toEqual([]);
    // The menu needs the difference between "nothing matched" and "nothing to
    // match against"; an empty list alone carries neither.
    expect(found.indexed).toBe(1);
  });

  it("refuses a project directory that is not there", async () => {
    await expect(searchWorkspaceFiles(join(root, "gone"), "a")).rejects.toThrow(/不存在/);
  });

  it("refuses a path that is not a directory", async () => {
    await writeFile(join(root, "file.txt"), "");
    await expect(searchWorkspaceFiles(join(root, "file.txt"), "a")).rejects.toThrow(/不是一个目录/);
  });

  it.skipIf(!gitAvailable)("prefers git, so ignored files stay out", async () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, ".gitignore"), "ignored.txt\n");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/app.ts"), "");
    await writeFile(join(root, "ignored.txt"), "");

    const found = await searchWorkspaceFiles(root, "", 100);
    const paths = found.items.map((item) => item.path);
    expect(paths).toContain("src");
    expect(paths).toContain("src/app.ts");
    expect(paths).toContain(".gitignore");
    expect(paths).not.toContain("ignored.txt");
  });
});
