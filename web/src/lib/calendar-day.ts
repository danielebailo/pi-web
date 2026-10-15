import { useEffect, useState } from "react";

/**
 * Midnight of the local day `now` falls in.
 *
 * The timestamp is carried around as a number so a memoized row can compare it
 * with `Object.is` and re-render exactly once a day, instead of re-reading the
 * clock on every render.
 */
export function startOfLocalDay(now: number): number {
  const at = new Date(now);
  at.setHours(0, 0, 0, 0);
  return at.getTime();
}

/**
 * Milliseconds from `now` until the next local midnight.
 *
 * `setHours(24, …)` instead of `+ 24 * 60 * 60 * 1000` so a daylight-saving
 * shift lands on the real midnight rather than an hour either side of it.
 */
export function msUntilNextLocalMidnight(now: number): number {
  const at = new Date(now);
  at.setHours(24, 0, 0, 0);
  return at.getTime() - now;
}

/**
 * The local day, re-armed at every midnight.
 *
 * Message timestamps drop the date while they are from today (see
 * `formatMessageClock`), and a transcript can easily stay open past midnight —
 * a session read from disk re-renders rarely enough that a row written at 23:50
 * would still be showing a bare `23:50` the next morning. One timer per
 * transcript, not one per row.
 */
export function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      const now = Date.now();
      setDay(startOfLocalDay(now));
      timer = setTimeout(arm, msUntilNextLocalMidnight(now));
    };
    timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()));
    return () => clearTimeout(timer);
  }, []);

  return day;
}
