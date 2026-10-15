import { SessionManager } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { openSessionForRead } from "./session-open.ts";

/**
 * Plan mode as the session file records it.
 *
 * Plan mode is owned by `extensions/plan-mode.ts`, which writes one `custom`
 * entry per transition — the newest one on the branch is the state, and there is
 * no live mirror anywhere. That is dsh's rule for `plan/mode` (log-only,
 * whole-value replace) reached with pi's `appendEntry`, and it is what makes
 * resume, fork and compaction recover the state for free.
 *
 * The constant is duplicated from the extension on purpose, the same way
 * `ask-user-codec.ts` duplicates the question prefix: the extension runs inside
 * the pi process and cannot import server code. It is a wire name, so the two
 * sides are changed together or not at all.
 */
export const PLAN_MODE_ENTRY = "pi-web-simple:plan-mode";

/**
 * Whether the branch's newest plan-mode entry says plan mode is active.
 *
 * Missing entries fold to inactive: a session that never saw the extension, and
 * a branch forked before the first `/plan`, both start out of plan mode rather
 * than in a state nothing accounts for. A payload that is not
 * `{ active: boolean }` is skipped rather than ending the search, so one
 * unreadable entry cannot hide the transition behind it.
 */
/**
 * The entry fields the branch fold reads; pi's `SessionEntry` satisfies this.
 */
export interface PlanEntryLike {
  id: string;
  parentId: string | null;
  type?: string;
  customType?: string;
  data?: unknown;
}

/**
 * Whether the branch ending at `leafId` holds an active plan mode.
 *
 * The RPC form of the same fold, and it is not a duplicate: the session file
 * lags the process — pi writes it lazily, on the first real message — so a
 * switch made in a session that has not spoken yet exists only in memory, where
 * `get_entries` can see it. The walk is the branch (leaf first, stopping at the
 * newest plan entry on it), which is what `getBranch()` gives the file reader.
 */
export function planActiveOfEntries(
  entries: readonly PlanEntryLike[],
  leafId: string | null,
): boolean {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let id: string | null = leafId;
  while (id !== null) {
    const entry = byId.get(id);
    if (entry === undefined) break;
    if (entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY) {
      const data = entry.data as { active?: unknown } | undefined;
      return data?.active === true;
    }
    id = entry.parentId ?? null;
  }
  return false;
}

export function sessionPlanActive(manager: SessionManager): boolean {
  let active = false;
  for (const entry of manager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== PLAN_MODE_ENTRY) continue;
    const data = entry.data as { active?: unknown } | undefined;
    if (typeof data?.active === "boolean") active = data.active;
  }
  return active;
}

/**
 * Plan mode for a session file, read from disk.
 *
 * Reuses the parse cache a switch already populates (`session-open.ts`), so this
 * costs nothing extra next to the composer read that fires beside it. An
 * unreadable file answers inactive for the same reason `readSessionComposition`
 * falls back to the default: the default is what a caller would get anyway, and
 * the spawn itself reports the real problem.
 */
export function readSessionPlanActive(sessionPath: string): boolean {
  if (statSync(sessionPath, { throwIfNoEntry: false }) === undefined) return false;
  try {
    return sessionPlanActive(openSessionForRead(sessionPath));
  } catch {
    return false;
  }
}
