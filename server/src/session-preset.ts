import { SessionManager } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { DEFAULT_PRESET_ID, presetIdFromSystemMessage } from "./presets.ts";
import { openSessionForRead } from "./session-open.ts";

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
  for (const entry of manager.getEntries()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "system") continue;
    return presetIdFromSystemMessage(message);
  }
  // No leading system message: a session pi minted but never sent a request for,
  // or one written before pi recorded prompt state. Either way there is nothing
  // to reverse, so the session is treated as the default composition.
  return DEFAULT_PRESET_ID;
}

/**
 * The preset for a session file, read from disk.
 *
 * Reuses the parse cache a switch already populates (`session-open.ts`), so when
 * the transcript and composer requests race the spawn, this costs nothing extra.
 */
export function readSessionPreset(sessionPath: string): string {
  if (statSync(sessionPath, { throwIfNoEntry: false }) === undefined) return DEFAULT_PRESET_ID;
  try {
    return presetIdOfSession(openSessionForRead(sessionPath));
  } catch {
    // An unreadable file is not a reason to refuse the session: the default
    // composition is what a caller would get anyway, and the spawn itself will
    // report the real problem.
    return DEFAULT_PRESET_ID;
  }
}
