import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The content font size is the one axis the settings page writes straight onto
 * the document, and *where* it lands is part of matching dsh: the theme
 * bootstrap's body script and the layout's ThemePresenter both write
 * `--dsh-content-font-size` on `body`, and `gradient-shadow-text.css` derives
 * the delta/secondary pair from it inside a `body` block. Writing it on
 * `documentElement` still inherits down to the conversation, so nothing would
 * look broken — it would just stop being the axis dsh publishes.
 *
 * The environment is node (no jsdom in this workspace), so the two style bags
 * are stubbed and the assertion is about which one received the write.
 */
function stubDocument() {
  const body = { setProperty: vi.fn(), removeProperty: vi.fn() };
  const documentElement = { setProperty: vi.fn(), removeProperty: vi.fn() };
  vi.stubGlobal("document", {
    body: { style: body },
    documentElement: { style: documentElement },
  });
  return { body, documentElement };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("applyContentFontSize", () => {
  it("writes the px value on body, where dsh publishes the axis", async () => {
    const { body, documentElement } = stubDocument();
    const { applyContentFontSize } = await import("./theme.ts");

    applyContentFontSize(17);

    expect(body.setProperty).toHaveBeenCalledWith("--dsh-content-font-size", "17px");
    expect(documentElement.setProperty).not.toHaveBeenCalled();
  });

  it("writes plain integer px so the derived calc() stays exact", async () => {
    const { body } = stubDocument();
    const { applyContentFontSize } = await import("./theme.ts");

    applyContentFontSize(10);
    applyContentFontSize(22);

    expect(body.setProperty).toHaveBeenLastCalledWith("--dsh-content-font-size", "22px");
    expect(body.setProperty).toHaveBeenCalledTimes(2);
  });
});
