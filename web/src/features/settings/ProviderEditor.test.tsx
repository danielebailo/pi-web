import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ModelProvider } from "../../lib/types.ts";
import { ProviderEditor } from "./ProviderEditor.tsx";

// Same reason as the section's test: pin the copy to one language.
vi.stubGlobal("navigator", { language: "en" });

const noop = (): void => {};
const apiProtocols = ["openai-completions", "anthropic-messages"];

function render(props: Parameters<typeof ProviderEditor>[0]): string {
  return renderToStaticMarkup(<ProviderEditor {...props} />);
}

describe("ProviderEditor", () => {
  it("keeps a known provider's technical fields collapsed behind the key", () => {
    const html = render({
      mode: "create-known",
      knownId: "openai",
      taken: [],
      apiProtocols,
      onClose: noop,
    });

    // The key is the one field the common case needs, so it is the one field
    // outside the disclosure.
    expect(html).toContain("API key");
    expect(html).toContain("Custom settings");
    // pi owns the route and the endpoint of a provider it ships; asking the
    // user to restate them would invite a typo in a value that has a default.
    expect(html).not.toContain("Provider ID");
    expect(html).toContain("Create provider");
  });

  it("opens the technical fields for a hand-declared provider", () => {
    const html = render({
      mode: "create-custom",
      taken: ["cz"],
      apiProtocols,
      onClose: noop,
    });

    // Nothing to fall back on, so the area that is collapsed elsewhere starts
    // open and the whole card is reachable without a click.
    expect(html).toContain("Provider ID");
    expect(html).toContain("API base URL");
    expect(html).toContain("API protocol");
    expect(html).toContain("Model catalog");
    // ...but an untouched field is not yet an error.
    expect(html).not.toContain("Enter a provider ID.");
  });

  it("renders the catalog as one row per model, collapsed", () => {
    const provider: ModelProvider = {
      id: "cz",
      name: "CZ",
      baseUrl: "https://api.example.com/v1",
      api: "openai-completions",
      configured: true,
      keySource: "auth",
      custom: true,
      models: [
        {
          id: "gpt-6.1-sol",
          name: "GPT 6.1 Sol",
          contextWindow: 256000,
          maxTokens: 32000,
          input: ["text", "image"],
          reasoning: true,
        },
      ],
    };
    const html = render({
      mode: "edit",
      provider,
      taken: ["cz"],
      apiProtocols,
      onClose: noop,
    });

    expect(html).toContain("gpt-6.1-sol");
    // The row's controls are named after the row they belong to.
    expect(html).toContain("Remove model 1");
    expect(html).toContain("Model options 1");
    // Capacities are the exception, not the norm: they stay behind the row's
    // own disclosure.
    expect(html).not.toContain("Context window");
  });
});
