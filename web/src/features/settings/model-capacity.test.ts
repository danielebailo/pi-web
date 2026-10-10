import { describe, expect, it } from "vitest";
import { formatCapacity, parseCapacity } from "./model-capacity.ts";

describe("parseCapacity", () => {
  it("reads a plain token count", () => {
    expect(parseCapacity("131072")).toBe(131072);
  });

  it("reads the K and M suffixes a person types instead of counting zeroes", () => {
    // Decimal, not binary: `256K` is what a model card quotes, and the stored
    // number is the decimal reading of it.
    expect(parseCapacity("256K")).toBe(256_000);
    expect(parseCapacity("256k")).toBe(256_000);
    expect(parseCapacity("1M")).toBe(1_000_000);
  });

  it("rounds a fractional multiple back to the integer it meant", () => {
    // `2.3 * 1e6` is a few ULPs off in binary floating point; storing that
    // would put a number in models.json that nobody typed.
    expect(parseCapacity("2.3M")).toBe(2_300_000);
    expect(parseCapacity("1.5K")).toBe(1_500);
  });

  it("treats a blank field as unset rather than as zero", () => {
    expect(parseCapacity("")).toBeUndefined();
    expect(parseCapacity("   ")).toBeUndefined();
  });

  it("reports unreadable text as NaN instead of guessing at a number", () => {
    expect(parseCapacity("abc")).toBeNaN();
    expect(parseCapacity("12x")).toBeNaN();
    expect(parseCapacity("-5")).toBeNaN();
    expect(parseCapacity("1,5M")).toBeNaN();
  });
});

describe("formatCapacity", () => {
  it("spells a round capacity in the shortest form that parses back", () => {
    expect(formatCapacity(1_000_000)).toBe("1M");
    expect(formatCapacity(256_000)).toBe("256K");
  });

  it("leaves a count that is not a whole number of thousands written out", () => {
    expect(formatCapacity(131072)).toBe("131072");
  });

  it("never turns a value it cannot spell into an empty field", () => {
    // The row's text buffer is what keeps `NaN` off screen; this is the last
    // line of defence, and `"NaN"` is at least visibly wrong rather than blank.
    expect(formatCapacity(Number.NaN)).toBe("NaN");
  });
});

describe("capacity round trip", () => {
  it("survives a trip through the field text", () => {
    for (const value of [256_000, 1_000_000, 131072, 8192]) {
      expect(parseCapacity(formatCapacity(value))).toBe(value);
    }
  });
});
