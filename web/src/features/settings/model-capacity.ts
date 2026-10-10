/**
 * The two token counts a model row edits, as text.
 *
 * A context window is a number in `models.json` but nobody thinks of one that
 * way: `128000` and `128K` are the same capacity, and only one of them fits in
 * the box without counting zeroes. So the fields hold text and this module is
 * the only place that translates between the two spellings — `formatCapacity`
 * on the way in, `parseCapacity` on the way out.
 *
 * Ported from dsh's `DeepSeekModelsEditor`, including its decimal scale: `1M` is
 * 1000K here, matching how model capacities are quoted, not 1024K.
 */

/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1000, m: 1_000_000 } as const;

/**
 * Read a typed capacity.
 *
 * @param text - raw field text.
 * @returns the token count; `undefined` when blank (which means "inherit"), and
 * `NaN` when the text is unreadable. `NaN` is not an error thrown here because
 * the caller keeps it as the row's value: the save is what refuses, so the
 * message can name a row the user can still see and correct.
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}

/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 *
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}
