import type { MessageKey, Translate } from "./i18n/index.ts";

/**
 * Copy for an agent preset, keyed by id rather than derived from it.
 *
 * `Translate` takes a literal key — the tables are typed so that a missing
 * translation is a compile error — and a computed key would need a cast, which
 * would hide exactly the mistake that typing is there to catch. An id with no
 * entry falls back to the id itself, which is what a preset added on the server
 * should read as until this file learns its name.
 */
const PRESET_NAME_KEYS: Record<string, MessageKey> = {
  standard: "preset.standard.name",
  minimal: "preset.minimal.name",
};

const PRESET_DESCRIPTION_KEYS: Record<string, MessageKey> = {
  standard: "preset.standard.description",
  minimal: "preset.minimal.description",
};

/** The preset's display name, or its id when this build does not know it. */
export function presetName(t: Translate, id: string): string {
  const key = PRESET_NAME_KEYS[id];
  return key === undefined ? id : t(key);
}

/** The one sentence describing the preset, or its id when unknown. */
export function presetDescription(t: Translate, id: string): string {
  const key = PRESET_DESCRIPTION_KEYS[id];
  return key === undefined ? id : t(key);
}
