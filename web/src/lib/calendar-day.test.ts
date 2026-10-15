import { describe, expect, it } from "vitest";
import { msUntilNextLocalMidnight, startOfLocalDay } from "./calendar-day.ts";

// The two helpers are pure and take the clock as an argument, so every
// expectation below is built from local dates rather than from a fixed epoch:
// the suite runs in whatever timezone the machine has, and a `getTime()` literal
// would pin one.

describe("startOfLocalDay", () => {
  it("truncates to local midnight", () => {
    const at = new Date(2026, 8, 17, 21, 0, 3, 400);
    expect(startOfLocalDay(at.getTime())).toBe(new Date(2026, 8, 17, 0, 0, 0, 0).getTime());
  });

  it("leaves midnight alone", () => {
    const midnight = new Date(2026, 8, 17, 0, 0, 0, 0).getTime();
    expect(startOfLocalDay(midnight)).toBe(midnight);
  });
});

describe("msUntilNextLocalMidnight", () => {
  it("counts to the next midnight, not back to today's", () => {
    const now = new Date(2026, 8, 17, 21, 0, 0, 0).getTime();
    const next = new Date(2026, 8, 18, 0, 0, 0, 0).getTime();
    expect(msUntilNextLocalMidnight(now)).toBe(next - now);
  });

  it("lands exactly on the next local day from the last moment of this one", () => {
    const now = new Date(2026, 8, 17, 23, 59, 59, 500).getTime();
    const at = new Date(now + msUntilNextLocalMidnight(now));
    expect(at.getDate()).toBe(18);
    expect([at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  it("is a whole local day from midnight", () => {
    const now = new Date(2026, 8, 17, 0, 0, 0, 0).getTime();
    const next = new Date(2026, 8, 18, 0, 0, 0, 0).getTime();
    // Written as two dates rather than `24 * 60 * 60 * 1000`: a daylight-saving
    // day is 23 or 25 hours long and `setHours` is what makes the rollover land
    // on the real midnight in that case.
    expect(msUntilNextLocalMidnight(now)).toBe(next - now);
  });
});
