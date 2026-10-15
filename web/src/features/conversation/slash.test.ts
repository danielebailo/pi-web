import { describe, expect, it } from "vitest";
import type { SlashCommand } from "../../lib/types.ts";
import { detectSlashTrigger, extensionCommandName, filterCommands, parseBuiltinCommand, planCommandOf, unknownCommandName } from "./slash.ts";

describe("detectSlashTrigger", () => {
  it("finds a slash at the start of the input", () => {
    expect(detectSlashTrigger("/", 1)).toEqual({ query: "", start: 0 });
    expect(detectSlashTrigger("/sk", 3)).toEqual({ query: "sk", start: 0 });
  });

  it("finds a slash that opens a word", () => {
    expect(detectSlashTrigger("hi /sk", 6)).toEqual({ query: "sk", start: 3 });
  });

  it("ignores a slash inside a word or path", () => {
    expect(detectSlashTrigger("a/b", 3)).toBeNull();
    expect(detectSlashTrigger("see /etc/hosts", 14)).toBeNull();
  });

  it("closes once an argument is typed", () => {
    expect(detectSlashTrigger("/skill:pdf extract", 18)).toBeNull();
  });

  it("keeps the colon so skill commands complete", () => {
    expect(detectSlashTrigger("/skill:", 7)).toEqual({ query: "skill:", start: 0 });
  });

  it("only considers text before the caret", () => {
    // Caret parked at the end of an earlier token.
    expect(detectSlashTrigger("/review /rev", 7)).toEqual({ query: "review", start: 0 });
    // Caret before the slash: nothing is being completed.
    expect(detectSlashTrigger("/review", 0)).toBeNull();
  });

  it("clamps a caret outside the value", () => {
    expect(detectSlashTrigger("/rev", 99)).toEqual({ query: "rev", start: 0 });
    expect(detectSlashTrigger("/rev", -5)).toBeNull();
  });
});

const commands: SlashCommand[] = [
  { name: "skill:pdf-tools", description: "Extract text from PDFs", source: "skill" },
  { name: "review", description: "Review the current diff", source: "prompt" },
  { name: "code-review", description: "Walk through a pull request", source: "prompt" },
  { name: "skill:brave-search", description: "Search the web", source: "skill" },
  { name: "export", description: "Write the PDF transcript out", source: "extension" },
];

const names = (query: string) => filterCommands(commands, query).map((command) => command.name);

describe("filterCommands", () => {
  it("returns everything for an empty query, grouped by kind then alphabetically", () => {
    expect(names("")).toEqual([
      "export",
      "code-review",
      "review",
      "skill:brave-search",
      "skill:pdf-tools",
    ]);
  });

  it("ranks a prefix match above a mere substring match", () => {
    expect(names("review")).toEqual(["review", "code-review"]);
  });

  it("ranks a name match above a description-only match", () => {
    // "skill:pdf-tools" matches on its name; "export" only on its description.
    expect(names("pdf")).toEqual(["skill:pdf-tools", "export"]);
  });

  it("finds a command by its description alone", () => {
    expect(names("web")).toEqual(["skill:brave-search"]);
  });

  it("is case-insensitive", () => {
    expect(names("REVIEW")).toEqual(["review", "code-review"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(names("zzz")).toEqual([]);
  });

  it("keeps equally good matches grouped by kind", () => {
    const equal: SlashCommand[] = [
      { name: "zeta", source: "skill" },
      { name: "alpha", source: "extension" },
      { name: "mid", source: "prompt" },
    ];
    expect(filterCommands(equal, "").map((command) => command.source)).toEqual([
      "extension",
      "prompt",
      "skill",
    ]);
  });

  it("ranks relevance above kind, so sectioning never buries the best match", () => {
    const mixed: SlashCommand[] = [
      { name: "zeta", source: "skill" },
      { name: "pdf-tools", source: "skill" },
      { name: "export", description: "writes PDFs", source: "extension" },
    ];
    // "pdf-tools" matches on its name; "export" only on its description, and
    // that outranks the fact that extensions section before skills.
    expect(filterCommands(mixed, "pdf").map((command) => command.name)).toEqual([
      "pdf-tools",
      "export",
    ]);
  });

  it("puts an exact skill name above a longer name that contains it", () => {
    // The namespace (`skill:`) is part of the name but not part of what the
    // user types, so `/search` has to rank `skill:search` by its tail —
    // otherwise `skill:brave-search` ties it and the alphabet decides.
    const namespaced: SlashCommand[] = [
      { name: "skill:brave-search", source: "skill" },
      { name: "skill:search", source: "skill" },
    ];
    expect(filterCommands(namespaced, "search").map((command) => command.name)).toEqual([
      "skill:search",
      "skill:brave-search",
    ]);
  });

  it("ranks a skill's tail prefix above a longer name's substring", () => {
    const mixed: SlashCommand[] = [
      { name: "skill:legacy-git-tools", source: "skill" },
      { name: "skill:git-commit", description: "Make a commit", source: "skill" },
      { name: "export", description: "writes git patches", source: "extension" },
    ];
    expect(filterCommands(mixed, "git").map((command) => command.name)).toEqual([
      "skill:git-commit",
      "skill:legacy-git-tools",
      "export",
    ]);
  });

  it("finds a separated name without the punctuation", () => {
    const namespaced: SlashCommand[] = [{ name: "skill:git-commit", source: "skill" }];
    expect(filterCommands(namespaced, "gitcommit").map((command) => command.name)).toEqual([
      "skill:git-commit",
    ]);
    expect(filterCommands(namespaced, "skillgit").map((command) => command.name)).toEqual([
      "skill:git-commit",
    ]);
  });

  it("puts built-in commands first when nothing is typed", () => {
    const withBuiltin: SlashCommand[] = [
      { name: "skill:pdf-tools", source: "skill" },
      { name: "compact", source: "builtin" },
      { name: "review", source: "prompt" },
    ];
    expect(filterCommands(withBuiltin, "").map((command) => command.name)).toEqual([
      "compact",
      "review",
      "skill:pdf-tools",
    ]);
  });
});

const runnable: SlashCommand[] = [
  { name: "compact", source: "builtin" },
  { name: "name", source: "builtin" },
  { name: "skill:pdf-tools", source: "skill" },
  { name: "plan", source: "extension" },
];

describe("parseBuiltinCommand", () => {
  it("splits a bare command", () => {
    expect(parseBuiltinCommand("/compact", runnable)).toEqual({
      command: runnable[0],
      args: "",
    });
  });

  it("splits its arguments", () => {
    expect(parseBuiltinCommand("/name 重构登录", runnable)?.args).toBe("重构登录");
  });

  it("keeps inner whitespace in the arguments", () => {
    expect(parseBuiltinCommand("/compact  keep  the  API  notes", runnable)?.args).toBe(
      "keep  the  API  notes",
    );
  });

  it("leaves commands pi expands itself alone", () => {
    // These are still ordinary prompts: pi expands them on delivery.
    expect(parseBuiltinCommand("/skill:pdf-tools extract", runnable)).toBeNull();
    expect(parseBuiltinCommand("/review", runnable)).toBeNull();
  });

  it("ignores text and paths", () => {
    expect(parseBuiltinCommand("hello", runnable)).toBeNull();
    expect(parseBuiltinCommand("fix /etc/hosts", runnable)).toBeNull();
    expect(parseBuiltinCommand("/etc/hosts", runnable)).toBeNull();
  });

  it("will not match a name containing a slash", () => {
    expect(parseBuiltinCommand("/compact/now", runnable)).toBeNull();
  });
});

describe("unknownCommandName", () => {
  it("names a command nothing in this composition registered", () => {
    // The minimal composition keeps no templates and no skills, which is
    // exactly the case this reports instead of letting the text pass as prose.
    expect(unknownCommandName("/review", runnable)).toBe("review");
    expect(unknownCommandName("/skill:pdf-tools extract", [])).toBe("skill:pdf-tools");
  });

  it("accepts everything the listing does offer", () => {
    expect(unknownCommandName("/compact", runnable)).toBeNull();
    expect(unknownCommandName("/skill:pdf-tools extract", runnable)).toBeNull();
  });

  it("ignores text and paths", () => {
    expect(unknownCommandName("hello", runnable)).toBeNull();
    expect(unknownCommandName("fix /etc/hosts", runnable)).toBeNull();
    expect(unknownCommandName("/etc/hosts", runnable)).toBeNull();
    expect(unknownCommandName("/compact/now", runnable)).toBeNull();
  });
});

describe("extensionCommandName", () => {
  it("names a command this composition registered as an extension", () => {
    expect(extensionCommandName("/plan", runnable)).toBe("plan");
    expect(extensionCommandName("/plan 重构登录", runnable)).toBe("plan");
  });

  it("leaves the other two kinds of slash text alone", () => {
    // A built-in maps to its own RPC, and a skill or template is expanded by pi
    // into an ordinary prompt — neither suppresses the optimistic user turn.
    expect(extensionCommandName("/compact", runnable)).toBeNull();
    expect(extensionCommandName("/skill:pdf-tools extract", runnable)).toBeNull();
  });

  it("ignores an unregistered name, text, and paths", () => {
    expect(extensionCommandName("/review", runnable)).toBeNull();
    expect(extensionCommandName("hello", runnable)).toBeNull();
    expect(extensionCommandName("fix /etc/hosts", runnable)).toBeNull();
    expect(extensionCommandName("/etc/hosts", runnable)).toBeNull();
    expect(extensionCommandName("/plan/now", runnable)).toBeNull();
  });
});

describe("planCommandOf", () => {
  it("says which way the command points", () => {
    expect(planCommandOf("/plan")).toBe(true);
    // A message rides along with the switch; it is still an enter.
    expect(planCommandOf("/plan 重构登录")).toBe(true);
    expect(planCommandOf("/plan off")).toBe(false);
    expect(planCommandOf("  /plan off  ")).toBe(false);
  });

  it("answers nothing for anything else", () => {
    // `/plan off` with a message is not the exit form: it is an enter whose
    // request happens to start with the word.
    expect(planCommandOf("/plan off please")).toBe(true);
    expect(planCommandOf("/planning")).toBeNull();
    expect(planCommandOf("plan")).toBeNull();
    expect(planCommandOf("/etc/hosts")).toBeNull();
  });
});
