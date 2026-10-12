import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET_ID,
  MINIMAL_SYSTEM_PROMPT,
  findPreset,
  listPresets,
  presetIdFromSystemMessage,
  presetSpawnArgs,
} from "./presets.ts";

describe("preset roster", () => {
  it("offers the default composition first", () => {
    expect(listPresets().map((preset) => preset.id)).toEqual([DEFAULT_PRESET_ID, "minimal"]);
  });

  it("answers null for an unknown id", () => {
    expect(findPreset("nope")).toBeNull();
    expect(findPreset("minimal")?.id).toBe("minimal");
  });
});

describe("presetSpawnArgs", () => {
  it("hands the default preset the question tool the manifest leaves out", () => {
    // `ask_user_question` is web-only by construction: the package manifest
    // does not list it, so no terminal session registers it, and the RPC
    // process this deployment spawns is given the file explicitly instead.
    const args = presetSpawnArgs(DEFAULT_PRESET_ID);
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("--extension");
    expect(args[1]).toMatch(/extensions[/\\]ask-user\.ts$/);
  });

  it("falls back to the default when no usable id was given", () => {
    expect(presetSpawnArgs("nope")).toEqual(presetSpawnArgs(DEFAULT_PRESET_ID));
    expect(presetSpawnArgs(undefined)).toEqual(presetSpawnArgs(DEFAULT_PRESET_ID));
  });

  it("composes minimal out of pi's own flags", () => {
    const args = presetSpawnArgs("minimal");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(MINIMAL_SYSTEM_PROMPT);
    expect(args[args.indexOf("--tools") + 1]).toBe("bash");
    expect(args).toContain("--no-context-files");
    expect(args).toContain("--no-skills");
    expect(args).toContain("--no-mcp");
    expect(args).toContain("--no-prompt-templates");
    expect(args).toContain("--no-extensions");
  });

  it("puts only the /web extension back after discovery is disabled", () => {
    // `--no-extensions` drops `todo`, which the manifest does list. The
    // question tool is not in the manifest at all, and the minimal roster keeps
    // no question batch either — so `/web` is the one extension restored.
    const args = presetSpawnArgs("minimal");
    const restored = args.slice(args.indexOf("--extension") + 1);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatch(/extensions[/\\]index\.js$/);
  });
});

describe("presetIdFromSystemMessage", () => {
  it("recognizes the minimal prompt, wherever pi put it", () => {
    expect(presetIdFromSystemMessage({ content: MINIMAL_SYSTEM_PROMPT })).toBe("minimal");
    expect(presetIdFromSystemMessage({ sections: { preamble: MINIMAL_SYSTEM_PROMPT } })).toBe(
      "minimal",
    );
  });

  it("still recognizes it beside the runtime sections pi appends", () => {
    // The shape observed with the flags this preset passes: `--system-prompt`
    // replaces the persona section, but pi attaches its own `<cwd>` section next
    // to it. Comparing the concatenation would miss the persona entirely, which
    // is why the match is per part.
    expect(
      presetIdFromSystemMessage({
        content: "",
        sections: {
          preamble: MINIMAL_SYSTEM_PROMPT,
          cwd: "<cwd>\n/private/tmp/project\n</cwd>",
        },
      }),
    ).toBe("minimal");
  });

  it("recognizes a lone bash tool when no prompt sections were recorded", () => {
    expect(presetIdFromSystemMessage({ content: "", toolsAdded: [{ name: "bash" }] })).toBe(
      "minimal",
    );
  });

  it("leaves the default composition alone", () => {
    expect(presetIdFromSystemMessage({ content: "You are a coding assistant." })).toBe(
      DEFAULT_PRESET_ID,
    );
    expect(
      presetIdFromSystemMessage({
        content: "",
        toolsAdded: [{ name: "read" }, { name: "bash" }, { name: "edit" }, { name: "write" }],
      }),
    ).toBe(DEFAULT_PRESET_ID);
  });

  it("does not read a larger tool set as minimal", () => {
    expect(
      presetIdFromSystemMessage({ content: "", toolsAdded: [{ name: "bash" }, { name: "read" }] }),
    ).toBe(DEFAULT_PRESET_ID);
  });
});
