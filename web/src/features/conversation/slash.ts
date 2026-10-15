import type { SlashCommand } from "../../lib/types.ts";
import type { Translate } from "../../lib/i18n/index.ts";

/** Where an in-progress `/command` started and what follows the slash. */
export interface SlashTrigger {
  /** Text between the slash and the caret; may contain `:` as in `skill:pdf`. */
  query: string;
  /** Index of the `/` within the value. */
  start: number;
}

/**
 * Detect a `/command` token immediately before the caret.
 *
 * The slash has to open a word, so `a/b` and `see /etc/hosts` are ordinary
 * prose while `/skill:pdf` is a command. Whitespace ends the token, which
 * closes the menu as soon as the user starts typing an argument.
 */
export function detectSlashTrigger(value: string, caret: number): SlashTrigger | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, safeCaret);
  const match = /(^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return { query, start: before.length - query.length - 1 };
}

/**
 * Section order in the menu, and the tiebreaker in `filterCommands`.
 * Relevance still wins: only equally good matches are held together by kind.
 */
const SOURCE_ORDER: Record<SlashCommand["source"], number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

/**
 * The part of a command name after its namespace: `git-commit` for
 * `skill:git-commit`. Skill and template commands are namespaced, so the tail
 * is the name the user is actually typing — matching it as a whole is what
 * keeps an exact skill name above a longer one that merely contains it.
 */
function tailOf(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * A name stripped of the punctuation between its words, so `git-commit` and
 * `gitcommit` become the same string. Only a fallback: a hit on the real text
 * always outranks it, which keeps `/gc` from drowning the menu in noise.
 */
function flatten(text: string): string {
  return text.replace(/[^a-z0-9]/g, "");
}

/** How well one command answers `needle`; lower is better, null is no match. */
function rankOf(command: SlashCommand, needle: string, flatNeedle: string): number | null {
  const name = command.name.toLowerCase();
  const tail = tailOf(name);
  if (name === needle || tail === needle) return 0;
  // The tail comes first so `/git-commit` surfaces `skill:git-commit` as a
  // prefix hit rather than leaving it to tie with every other substring match.
  if (tail.startsWith(needle) || name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (flatNeedle.length >= 2 && flatten(name).includes(flatNeedle)) return 3;
  const description = command.description?.toLowerCase();
  if (description === undefined) return null;
  if (description.includes(needle)) return 4;
  return flatNeedle.length >= 2 && flatten(description).includes(flatNeedle) ? 4 : null;
}

/**
 * Commands matching a query, best match first: an exact name (or the name after
 * its `skill:`/template namespace), then a prefix of either, then a substring
 * of the name, then a punctuation-insensitive hit, then the description alone.
 * Ties fall back to the section order so equal matches stay grouped — with an
 * empty query every result is rank 0, which is what makes the menu read as
 * sections.
 */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  const flatNeedle = flatten(needle);
  const scored: { command: SlashCommand; rank: number }[] = [];

  for (const command of commands) {
    const rank = needle.length === 0 ? 0 : rankOf(command, needle, flatNeedle);
    if (rank !== null) scored.push({ command, rank });
  }

  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        SOURCE_ORDER[a.command.source] - SOURCE_ORDER[b.command.source] ||
        a.command.name.localeCompare(b.command.name),
    )
    .map((entry) => entry.command);
}

/** Human labels for the badge shown next to each command. */
/** Source labels for the command menu, built from `t` for the same reason as
 * every other table here: the wording has to follow the language setting. */
export function sourceLabels(t: Translate): Record<SlashCommand["source"], string> {
  return {
    builtin: t("slash.builtin"),
    skill: t("slash.skill"),
    prompt: t("slash.prompt"),
    extension: t("slash.extension"),
  };
}

/**
 * Split `/<name> <args>` when `name` is a built-in command this UI can run.
 *
 * Returns null for everything else — including `/skill:…` and prompt
 * templates, which pi expands on its own — so those are still sent as ordinary
 * prompts. The name may not contain a slash, so `/etc/hosts` never matches.
 */
export function parseBuiltinCommand(
  text: string,
  commands: SlashCommand[],
): { command: SlashCommand; args: string } | null {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;

  const name = match[1] ?? "";
  const command = commands.find((entry) => entry.source === "builtin" && entry.name === name);
  if (!command) return null;

  return { command, args: (match[2] ?? "").trim() };
}

/**
 * The name when `text` is a `/command` this composition registered as an
 * **extension** command, or null for everything else.
 *
 * Extension commands are the third kind of slash text, and the only one that
 * needs a caller to know what it is: pi consumes the command and records only
 * the message the command itself submits, so the composer must not draw the
 * typed line as a user turn (see `useConversation.runCommand`). Built-ins are
 * answered by `parseBuiltinCommand`, and skills and templates are expanded by pi
 * into ordinary prompts, which is why neither appears here.
 */
export function extensionCommandName(text: string, commands: SlashCommand[]): string | null {
  const match = /^\/([^\s/]+)(?:\s+[\s\S]*)?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1] ?? "";
  if (name.length === 0) return null;
  return commands.some((command) => command.source === "extension" && command.name === name)
    ? name
    : null;
}

/**
 * The mode `/plan` asks for, or null when the text is not that command.
 *
 * `true` is "enter", `false` is the exact `/plan off`, and a `/plan <message>`
 * is an enter with a request behind it. It lives here rather than inline at each
 * sender because the command belongs to this deployment — a new session's first
 * message and an established one's both have to agree about what it is, and the
 * hero sending it as plain text used to leave a turn nothing ever wrote.
 */
export function planCommandOf(text: string): boolean | null {
  const trimmed = text.trim();
  if (!/^\/plan(\s+[\s\S]*)?$/.test(trimmed)) return null;
  return !/^\/plan\s+off\s*$/.test(trimmed);
}

/**
 * The name of a slash command nothing in this composition registered.
 *
 * Returns null for everything that is not a bare `/name`: ordinary prose such as
 * `/etc/hosts`, and anything with a slash inside it. `/skill:…` is a name in its
 * own right, so it takes the same lookup as any other.
 *
 * `parseBuiltinCommand` answers whether the text can run here; this answers the
 * rest of the same question, so a typed command that no process registered is
 * said out loud instead of quietly becoming prose. pi would pass it through to
 * the model unchanged, which reads like a command that did nothing rather than
 * like a command that does not exist — and in a minimal composition that is the
 * usual case, since it keeps no templates and no skills.
 */
export function unknownCommandName(text: string, commands: SlashCommand[]): string | null {
  const match = /^\/([^\s/]+)(?:\s+[\s\S]*)?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1] ?? "";
  if (name.length === 0) return null;
  return commands.some((command) => command.name === name) ? null : name;
}
