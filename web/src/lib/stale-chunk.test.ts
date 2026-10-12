import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadOnceForStaleChunk } from "./stale-chunk.ts";

/**
 * The once-per-chunk reload.
 *
 * What matters is the arity of the answer: the first failure reloads, the same
 * one again does not, and a different chunk gets its own reload. The last of
 * those is what keeps a page that came back still broken from looping.
 */

let reloads = 0;

/** `sessionStorage` as the page uses it: a string map that outlives a reload. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

beforeEach(() => {
  reloads = 0;
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("location", {
    reload: () => {
      reloads += 1;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reloadOnceForStaleChunk", () => {
  it("reloads on a chunk's first failure", () => {
    expect(reloadOnceForStaleChunk("terminal-tab")).toBe(true);
    expect(reloads).toBe(1);
  });

  it("lets the second failure of the same chunk through", () => {
    expect(reloadOnceForStaleChunk("terminal-tab")).toBe(true);
    // The page came back and this chunk is still missing, so the error has to
    // reach the boundary: reloading again would be a loop with no exit.
    expect(reloadOnceForStaleChunk("terminal-tab")).toBe(false);
    expect(reloads).toBe(1);
  });

  it("gives a different chunk its own reload", () => {
    expect(reloadOnceForStaleChunk("terminal-tab")).toBe(true);
    expect(reloadOnceForStaleChunk("grammar:python")).toBe(true);
    expect(reloads).toBe(2);
  });

  it("surfaces the error rather than risking a loop when storage is denied", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(reloadOnceForStaleChunk("terminal-tab")).toBe(false);
    expect(reloads).toBe(0);
  });
});
