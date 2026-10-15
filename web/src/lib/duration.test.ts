import { translator } from "./i18n/index.ts";
import { describe, expect, it } from "vitest";
import {
  formatMessageClock,
  formatRunDuration,
  formatTokens,
  formatTurnDuration,
  secondsUntil,
} from "./duration.ts";

// The assertions below pin the Chinese copy; the translator is passed in rather
// than resolved from a host locale, so the test says which language it means.
const zh = translator("zh-CN");

describe("formatRunDuration", () => {
  it("reports bare seconds under a minute", () => {
    expect(formatRunDuration(0, zh)).toBe("0秒");
    expect(formatRunDuration(1_000, zh)).toBe("1秒");
    expect(formatRunDuration(15_000, zh)).toBe("15秒");
    expect(formatRunDuration(59_999, zh)).toBe("59秒");
  });

  it("switches to minutes and pads the seconds", () => {
    expect(formatRunDuration(60_000, zh)).toBe("1分00秒");
    expect(formatRunDuration(65_000, zh)).toBe("1分05秒");
    expect(formatRunDuration(125_000, zh)).toBe("2分05秒");
    expect(formatRunDuration(600_000, zh)).toBe("10分00秒");
  });

  it("truncates rather than rounds, so the clock never reads ahead", () => {
    expect(formatRunDuration(1_999, zh)).toBe("1秒");
    expect(formatRunDuration(59_999, zh)).toBe("59秒");
    expect(formatRunDuration(60_999, zh)).toBe("1分00秒");
  });

  it("clamps a negative elapsed time, which a clock skew can produce", () => {
    // The anchor comes from the host; a turn started on a machine a second
    // ahead would otherwise render "-1秒".
    expect(formatRunDuration(-5_000, zh)).toBe("0秒");
  });
});

describe("secondsUntil", () => {
  const now = 1_000_000;

  it("rounds up so the final second still reads as 1", () => {
    expect(secondsUntil(now + 1, now)).toBe(1);
    expect(secondsUntil(now + 999, now)).toBe(1);
    expect(secondsUntil(now + 1_001, now)).toBe(2);
    expect(secondsUntil(now + 5_000, now)).toBe(5);
  });

  it("returns zero once the deadline has passed", () => {
    // This is the signal the retry row branches on to stop counting down.
    expect(secondsUntil(now, now)).toBe(0);
    expect(secondsUntil(now - 1, now)).toBe(0);
    expect(secondsUntil(now - 60_000, now)).toBe(0);
  });

  it("never counts down past zero", () => {
    for (const delta of [0, -1, -10_000, -86_400_000]) {
      expect(secondsUntil(now + delta, now)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("formatTurnDuration", () => {
  it("keeps one decimal below a minute, as dsh's compactSeconds does", () => {
    expect(formatTurnDuration(42_000, zh)).toBe("42秒");
    expect(formatTurnDuration(1_400, zh)).toBe("1.4秒");
    expect(formatTurnDuration(45_200, zh)).toBe("45.2秒");
    expect(formatTurnDuration(0, zh)).toBe("0秒");
  });

  it("switches to minutes and seconds at 60s", () => {
    expect(formatTurnDuration(60_000, zh)).toBe("1分0秒");
    expect(formatTurnDuration(162_000, zh)).toBe("2分42秒");
    // 59.6s is still under the minute, so it stays in the decimal branch —
    // the same boundary dsh's compactSeconds uses.
    expect(formatTurnDuration(59_600, zh)).toBe("59.6秒");
  });
});

describe("formatTokens", () => {
  it("shows plain counts below a thousand", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("abbreviates thousands and millions the way dsh labels them", () => {
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(760_000)).toBe("760K");
    expect(formatTokens(1_700_000)).toBe("1.7M");
  });
});

describe("formatMessageClock", () => {
  // `now` is always passed in: the function's whole job is the comparison, and
  // a test that read the real clock would change meaning at midnight.
  it("drops the date while the message is from today", () => {
    const now = new Date(2026, 8, 17, 23, 30).getTime();
    expect(formatMessageClock(new Date(2026, 8, 17, 21, 0).getTime(), zh, now)).toBe("21:00");
    expect(formatMessageClock(new Date(2026, 8, 17, 9, 5).getTime(), zh, now)).toBe("09:05");
  });

  it("spells the date out once the day has moved on", () => {
    const now = new Date(2026, 8, 18, 0, 30).getTime();
    expect(formatMessageClock(new Date(2026, 8, 17, 23, 58).getTime(), zh, now)).toBe("9月17日 23:58");
  });

  it("adds the year across a year boundary", () => {
    const now = new Date(2026, 0, 2, 10, 0).getTime();
    expect(formatMessageClock(new Date(2025, 11, 31, 23, 58).getTime(), zh, now)).toBe(
      "2025年12月31日 23:58",
    );
  });

  it("writes the date in the locale's own shape", () => {
    const en = translator("en");
    const thisYear = new Date(2026, 8, 18, 0, 30).getTime();
    expect(formatMessageClock(new Date(2026, 8, 17, 21, 0).getTime(), en, thisYear)).toBe("9/17 21:00");
    const nextYear = new Date(2027, 0, 2, 10, 0).getTime();
    expect(formatMessageClock(new Date(2026, 8, 17, 21, 0).getTime(), en, nextYear)).toBe(
      "2026-9-17 21:00",
    );
  });
});
