/**
 * Document-wide input tracking, shared by the focus-ring styles.
 *
 * Ported from deepseek-harness (packages/client/ui-primitives/src/input-modality.ts).
 * `theme/focus.css` reads the attribute this publishes: a ring painted by a
 * click is noise, while one painted after Tab is the only way to see where
 * focus went. Modifiers and refocusing alone keep rings silent.
 *
 * The listeners live for the document's lifetime, so this is registered once
 * from the entry point rather than from a component.
 */

/** Modality values published on the document element. */
export const INPUT_MODALITY = { pointer: "pointer", keyboard: "keyboard" } as const;

/** Attribute carrying whether focus navigation last owned focus. */
export const INPUT_MODALITY_ATTRIBUTE = "data-input-modality";

const FOCUS_NAVIGATION = new Set(["Tab", "Home", "End", "PageUp", "PageDown"]);

/** Publish the modality that last owned focus. */
export function watchInputModality(): void {
  let pointerOwnsFocus = false;
  let keyFocusOrigin: EventTarget | undefined;

  const publish = (): void => {
    document.documentElement.setAttribute(
      INPUT_MODALITY_ATTRIBUTE,
      pointerOwnsFocus ? INPUT_MODALITY.pointer : INPUT_MODALITY.keyboard,
    );
  };

  window.addEventListener(
    "pointerdown",
    () => {
      pointerOwnsFocus = true;
      keyFocusOrigin = undefined;
      publish();
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing) {
        keyFocusOrigin = undefined;
        return;
      }
      // composedPath preserves the real control inside an open shadow root.
      keyFocusOrigin = event.composedPath()[0];
      if (!FOCUS_NAVIGATION.has(event.key) && !event.key.startsWith("Arrow")) return;
      pointerOwnsFocus = false;
      publish();
    },
    true,
  );

  window.addEventListener(
    "focusin",
    (event) => {
      // Focus that moved because of a key (not a click) re-reveals the ring.
      if (keyFocusOrigin === undefined || event.composedPath()[0] === keyFocusOrigin) return;
      keyFocusOrigin = undefined;
      if (!pointerOwnsFocus) return;
      pointerOwnsFocus = false;
      publish();
    },
    true,
  );

  window.addEventListener("blur", () => {
    keyFocusOrigin = undefined;
  });
}
