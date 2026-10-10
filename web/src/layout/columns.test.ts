import { describe, expect, it } from "vitest";
import {
  CENTER_MIN,
  RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampWidth,
  computeColumns,
  isNarrow,
} from "./columns.ts";

describe("clampWidth", () => {
  it("keeps a width inside its range", () => {
    expect(clampWidth(320, 300, 900)).toBe(320);
  });

  it("raises a width below the floor and lowers one above the ceiling", () => {
    expect(clampWidth(10, 300, 900)).toBe(300);
    expect(clampWidth(5_000, 300, 900)).toBe(900);
  });

  it("rounds to whole pixels", () => {
    expect(clampWidth(320.4, 300, 900)).toBe(320);
    expect(clampWidth(320.6, 300, 900)).toBe(321);
  });
});

describe("computeColumns", () => {
  it("gives the right column exactly what it asks for when the frame is wide", () => {
    expect(computeColumns(1_440, SIDEBAR_DEFAULT, 420)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 1_440 - SIDEBAR_DEFAULT - 420,
      rightbar: 420,
    });
  });

  it("clamps the sidebar preference into its drag range", () => {
    expect(computeColumns(1_440, 10, 420).sidebar).toBe(SIDEBAR_MIN);
    expect(computeColumns(1_440, 900, 420).sidebar).toBe(SIDEBAR_MAX);
  });

  it("drops the right track when the centre would fall below its minimum", () => {
    // 300 - 280 - 400 is already negative: there is no room for a track, and
    // only without it may the centre fall below `CENTER_MIN` — here to 20.
    const columns = computeColumns(300, SIDEBAR_DEFAULT, 420);
    expect(columns.rightbar).toBe(0);
    expect(columns.center).toBe(300 - SIDEBAR_DEFAULT);
  });

  it("shrinks the right column to the room the centre leaves, never below it", () => {
    const columns = computeColumns(1_100, SIDEBAR_DEFAULT, 420);
    expect(columns.rightbar).toBeGreaterThanOrEqual(RIGHTBAR_MIN);
    expect(columns.center).toBeGreaterThanOrEqual(CENTER_MIN);
    expect(columns.rightbar).toBe(1_100 - SIDEBAR_DEFAULT - CENTER_MIN);
  });

  it("caps the right column at the frame ratio even when the preference is larger", () => {
    // 3000 - 280 - 400 = 2320 of room, so the ratio cap is the binding one:
    // 3000 * 0.7 = 2100, and a 2500px preference is clamped to it.
    expect(computeColumns(3_000, SIDEBAR_DEFAULT, 2_500).rightbar).toBe(2_100);
  });

  it("keeps a zero preference a zero track whichever way the centre leans", () => {
    expect(computeColumns(1_440, SIDEBAR_DEFAULT, 0).rightbar).toBe(0);
  });

  it("uses the collapsed width for a collapsed sidebar, and 0 by default", () => {
    // This shell has no rail, so the default collapse disappears entirely.
    expect(computeColumns(1_440, 0, 420).sidebar).toBe(0);
    expect(computeColumns(1_440, 0, 420, 56).sidebar).toBe(56);
  });
});

describe("isNarrow", () => {
  it("treats an unmeasured frame as wide, not as a phone", () => {
    // 0 is "the observer has not reported yet", and the first commit must not
    // flash a drawer over a desktop layout.
    expect(isNarrow(0)).toBe(false);
  });

  it("splits exactly at the auto-collapse breakpoint", () => {
    expect(isNarrow(SIDEBAR_AUTO_COLLAPSE - 1)).toBe(true);
    expect(isNarrow(SIDEBAR_AUTO_COLLAPSE)).toBe(false);
  });
});
