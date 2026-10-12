import { describe, expect, it } from "vitest";
import { detectAtTrigger } from "./file-token.ts";
import { REFERENCE_SLOT } from "./reference-token.ts";

describe("detectAtTrigger", () => {
  it("finds a bare sigil at the start of the draft", () => {
    expect(detectAtTrigger("@", 1)).toEqual({ query: "", start: 0 });
    expect(detectAtTrigger("@api", 4)).toEqual({ query: "api", start: 0 });
  });

  it("finds one that opens a word", () => {
    expect(detectAtTrigger("look at @src/lib", 16)).toEqual({ query: "src/lib", start: 8 });
  });

  it("follows a bracket or a quote, which are boundaries too", () => {
    expect(detectAtTrigger("(@api", 5)).toEqual({ query: "api", start: 1 });
    expect(detectAtTrigger('"@api', 5)).toEqual({ query: "api", start: 1 });
  });

  it("follows CJK punctuation, where there is no space to lean on", () => {
    expect(detectAtTrigger("看看，@api", 7)).toEqual({ query: "api", start: 3 });
  });

  it("ignores a sigil glued to a Han character", () => {
    // The TUI draws the same line: whitespace and CJK punctuation open a token,
    // a letter or a Han character does not — prose running straight into the
    // sigil is not a reference.
    expect(detectAtTrigger("看看@api", 6)).toBeNull();
  });

  it("ignores an at-sign inside a word", () => {
    expect(detectAtTrigger("mail@example.com", 16)).toBeNull();
    expect(detectAtTrigger("user@host", 9)).toBeNull();
  });

  it("closes once whitespace ends the token", () => {
    expect(detectAtTrigger("@api then", 9)).toBeNull();
  });

  it("reads the quoted form, which is how a path with spaces is typed", () => {
    expect(detectAtTrigger('@"my file', 9)).toEqual({ query: "my file", start: 0 });
  });

  it("closes at the closing quote", () => {
    expect(detectAtTrigger('@"my file"', 10)).toBeNull();
  });

  it("keeps working inside a directory chip, so the walk can continue", () => {
    // A directory reference is inserted without a trailing space and with the
    // caret against its label, which is exactly what makes the next keystroke
    // a deeper query (`@src/lib/` then `ap`). The sigil in front of the caret is
    // the same one, and the menu replaces the whole token rather than its tail.
    const drafted = `see ${REFERENCE_SLOT}@src/lib/ap`;
    expect(detectAtTrigger(drafted, drafted.length)).toEqual({
      query: "src/lib/ap",
      start: drafted.indexOf("@"),
    });
  });

  it("only considers text before the caret", () => {
    expect(detectAtTrigger("@api @src", 4)).toEqual({ query: "api", start: 0 });
    expect(detectAtTrigger("@api", 0)).toBeNull();
  });

  it("clamps a caret outside the value", () => {
    expect(detectAtTrigger("@api", 99)).toEqual({ query: "api", start: 0 });
    expect(detectAtTrigger("@api", -5)).toBeNull();
  });
});
