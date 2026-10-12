import { describe, expect, it } from "vitest";
import { translator } from "./i18n/index.ts";
import { presetDescription, presetName } from "./presets.ts";

const zh = translator("zh-CN");
const en = translator("en");

describe("preset copy", () => {
  it("names the compositions in either language", () => {
    expect(presetName(zh, "standard")).toBe("标准");
    expect(presetName(zh, "minimal")).toBe("极简模式");
    expect(presetName(en, "minimal")).toBe("Minimal mode");
  });

  it("describes them with a sentence rather than repeating the name", () => {
    expect(presetDescription(en, "minimal")).toMatch(/bash/);
    expect(presetDescription(zh, "minimal")).not.toBe(presetName(zh, "minimal"));
  });

  it("falls back to the id for a composition this build does not know", () => {
    // A preset added on the server renders as its own id until a human names it
    // — an obvious seam, rather than a wrong label borrowed from another one.
    expect(presetName(en, "turbo")).toBe("turbo");
    expect(presetDescription(en, "turbo")).toBe("turbo");
  });
});
