import { SessionManager } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { DEFAULT_PRESET_ID, presetIdFromSystemMessage } from "./presets.ts";
import { openSessionForRead } from "./session-open.ts";

/**
 * How a session was composed, and whether that is still the caller's to change.
 *
 * `locked` is the line dsh draws with `agent-preset-locked`, measured in pi's
 * own evidence: the leading system message exists only once a request has been
 * sent, and that is the moment the transcript starts holding tool calls made
 * under this composition. Before it, nothing has been produced under these
 * arguments, so replacing them contradicts no history.
 */
export interface SessionComposition {
  /** The composition the session runs, as its own file records it. */
  presetId: string;
  /** True once the session has recorded its leading system message. */
  locked: boolean;
}

/**
 * The composition a parsed session implies, and whether it is already fixed.
 *
 * The same scan answers both questions, because they come from the same entry:
 * the first system message is at once the evidence of *what* was composed and
 * of *that* it was already used.
 */
export function sessionComposition(manager: SessionManager): SessionComposition {
  for (const entry of manager.getEntries()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "system") continue;
    return { presetId: presetIdFromSystemMessage(message), locked: true };
  }
  // No leading system message: a session pi minted but never sent a request
  // for, or one written before pi recorded prompt state. Nothing was produced
  // under any composition, so the choice is still open and the default is what
  // a caller would get anyway.
  return { presetId: DEFAULT_PRESET_ID, locked: false };
}

/**
 * The composition of a session file, read from disk.
 *
 * Reuses the parse cache a switch already populates (`session-open.ts`), so when
 * the transcript and composer requests race the spawn, this costs nothing extra.
 */
export function readSessionComposition(sessionPath: string): SessionComposition {
  if (statSync(sessionPath, { throwIfNoEntry: false }) === undefined) {
    return { presetId: DEFAULT_PRESET_ID, locked: false };
  }
  try {
    return sessionComposition(openSessionForRead(sessionPath));
  } catch {
    // An unreadable file is not a reason to refuse the session: the default
    // composition is what a caller would get anyway, and the spawn itself will
    // report the real problem.
    return { presetId: DEFAULT_PRESET_ID, locked: false };
  }
}

/**
 * Which agent preset an existing session was composed with.
 *
 * A preset is not recorded anywhere of its own — it only exists as the
 * arguments pi was started with. What pi *does* persist is the consequence: the
 * first request of a session writes a leading system message carrying the whole
 * prompt and the tool declarations (`docs/session-format.md`), and that is the
 * same evidence dsh keeps in its `agentPreset` session projection.
 *
 * This matters on the way *in*, not just for a label. Opening a minimal session
 * under the default composition would spawn a process with the full prompt and
 * tool set, which then appends a system message patching the session's own
 * composition — the file would say one thing and the running process another.
 * The preset a session reports is therefore what the next spawn is started with.
 */
export function presetIdOfSession(manager: SessionManager): string {
  return sessionComposition(manager).presetId;
}
