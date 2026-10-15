import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appStore, resetAppState } from "../../lib/app-state.ts";
import type { ModelProvider, ModelsView } from "../../lib/types.ts";
import { ModelsSection } from "./ModelsSection.tsx";

// The copy renders through `useT`, which falls back to the host locale when the
// preference is `system`. Pin it so the assertions read one language.
vi.stubGlobal("navigator", { language: "en" });

afterEach(() => {
  resetAppState();
});

function provider(overrides: Partial<ModelProvider>): ModelProvider {
  return {
    id: "openai",
    name: "openai",
    baseUrl: null,
    api: null,
    configured: false,
    keySource: null,
    custom: false,
    models: [],
    ...overrides,
  };
}

/** Render the section against one file's worth of providers. */
function render(providers: ModelProvider[]): string {
  const view: ModelsView = {
    providers,
    modelsPath: "/home/pi/.pi/agent/models.json",
    authPath: "/home/pi/.pi/agent/auth.json",
    knownProviders: ["openai", "anthropic"],
    apiProtocols: ["openai-completions", "anthropic-messages"],
  };
  appStore.set({ ...appStore.get(), models: view });
  return renderToStaticMarkup(<ModelsSection />);
}

describe("ModelsSection", () => {
  it("lists a configured provider as a card with its credential state", () => {
    const html = render([
      provider({ id: "cz", name: "CZ", configured: true, keySource: "auth" }),
      provider({ id: "local", name: "Local", custom: true }),
    ]);

    // The badge marks a provider pi does not ship, and only that one.
    expect(html.match(/Custom</g)).toHaveLength(1);
    // The dot reports what the files hold, in words, not just a color.
    expect(html).toContain("API key configured");
    expect(html).toContain("API key missing");
    // The row's own editor is behind a button, so it is not in the first paint.
    expect(html).not.toContain('type="password"');
  });

  it("offers one entry point to add a provider", () => {
    const html = render([provider({ id: "cz", name: "CZ", configured: true })]);

    // dsh's add flow: one button, whose card chooses between the catalog and a
    // hand-declared API. Two buttons here would be a different flow.
    expect(html.match(/Add model provider/g)).toHaveLength(1);
  });

  it("says the catalog is loading rather than showing an empty one", () => {
    const html = renderToStaticMarkup(<ModelsSection />);

    expect(html).toContain("Loading providers…");
    expect(html).not.toContain("Add model provider");
  });
});
