// Theme first: it is the base layer, so component CSS Modules (pulled in via
// App) must come after it in the cascade. Importing it last would let global
// rules such as `:focus-visible` override component-level resets.
import "./theme/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { appStore } from "./lib/app-state.ts";
import { markDocumentPlatform } from "./lib/desktop.ts";
import { watchInputModality } from "./lib/input-modality.ts";
import { applyAppearance, watchSystemAppearance } from "./lib/theme.ts";

// Before the first mount, so the macOS sidebar tint is already in force when
// the shell paints its first frame (see the function's note).
markDocumentPlatform();

// Also before the first mount: `theme/focus.css` reads the modality attribute
// this publishes, so a ring suppressed on click has to be suppressible from the
// very first click (see the module's note).
watchInputModality();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found");
}

// Registered once, outside React: the OS scheme flipping is a property of the
// environment, not of any component's lifetime. Only `system` reacts — once the
// user has picked a literal colour, a system change must not override it.
watchSystemAppearance(() => {
  if (appStore.get().settings.appearance === "system") applyAppearance("system");
});

// The boundary is created here rather than inside `App` because the errors it
// exists for come out of `App`'s own subtree: whatever sits above it is the
// last thing standing when React unmounts a root, and an empty `#root` in a
// desktop window is a blank page with no reason on it.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
