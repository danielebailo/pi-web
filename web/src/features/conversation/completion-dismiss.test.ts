import { describe, expect, it } from "vitest";
import { resolveCompletion } from "./completion-dismiss.ts";

const token = (start: number, query: string) => ({ start, query });

describe("resolveCompletion", () => {
  it("holds a dismissal for the very token it named", () => {
    // The same slash with the same query, re-tracked by the keyup an Escape
    // leaves behind: the menu must stay closed.
    const resolved = resolveCompletion(token(0, "re"), token(0, "re"), token(0, "re"));
    expect(resolved).toEqual({ dismissed: token(0, "re"), trigger: token(0, "re") });
  });

  it("re-arms on a longer query, the way dsh does", () => {
    const resolved = resolveCompletion(token(0, "re"), token(0, "re"), token(0, "rev"));
    expect(resolved.dismissed).toBeNull();
    expect(resolved.trigger).toEqual(token(0, "rev"));
  });

  it("re-arms when the slash is erased, so typing it again opens the menu", () => {
    // Erasing the slash: nothing is live any more, and the stale veto has to go
    // with it.
    const erased = resolveCompletion(token(0, "re"), token(0, "re"), null);
    expect(erased).toEqual({ dismissed: null, trigger: null });
    // The next slash is no longer silenced.
    const reopened = resolveCompletion(null, erased.dismissed, token(0, ""));
    expect(reopened.dismissed).toBeNull();
    expect(reopened.trigger).toEqual(token(0, ""));
  });

  it("re-arms on a different token", () => {
    const resolved = resolveCompletion(token(0, "re"), token(0, "re"), token(6, "re"));
    expect(resolved.dismissed).toBeNull();
    expect(resolved.trigger).toEqual(token(6, "re"));
  });

  it("opens when nothing was ever dismissed", () => {
    expect(resolveCompletion(null, null, token(0, ""))).toEqual({
      dismissed: null,
      trigger: token(0, ""),
    });
  });
});
