import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The module caches its `MediaQueryList` on first use, so every case re-imports
 * it after stubbing — otherwise the first test's answer would be every test's
 * answer.
 */
async function loadWith(matches: boolean | null) {
  vi.resetModules();
  vi.stubGlobal("matchMedia", matches === null ? undefined : vi.fn(() => ({ matches })));
  return await import("./pointer.ts");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("isCoarsePointer", () => {
  it("is true when the primary pointer is a finger", async () => {
    const { isCoarsePointer } = await loadWith(true);
    expect(isCoarsePointer()).toBe(true);
  });

  it("is false for a precision pointer", async () => {
    const { isCoarsePointer } = await loadWith(false);
    expect(isCoarsePointer()).toBe(false);
  });

  it("is false where the query cannot be asked at all", async () => {
    // An engine without `matchMedia` is not a touch device, and the caller's
    // desktop branch is the one that leaves the composer's Enter key alone.
    const { isCoarsePointer } = await loadWith(null);
    expect(isCoarsePointer()).toBe(false);
  });
});
