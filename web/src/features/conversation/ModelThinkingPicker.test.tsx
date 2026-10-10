import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModelThinkingPicker } from "./ModelThinkingPicker.tsx";
import type { ComposerModel } from "../../lib/types.ts";

// Same reason `SessionStats.test.tsx` pins it: the copy asserted below is the
// Chinese one, and a bare node environment offers no navigator to prefer it.
vi.stubGlobal("navigator", { language: "zh-CN" });

const noop = (): void => {};

const DEEPSEEK: ComposerModel = {
  provider: "deepseek",
  id: "deepseek-v3",
  name: "DeepSeek V3",
  contextWindow: 128_000,
  reasoning: true,
  thinkingLevels: ["off", "low", "medium", "high"],
};

interface Overrides {
  model?: ComposerModel | null;
  level?: string | null;
  levels?: string[] | null;
}

function render({ model = DEEPSEEK, level = null, levels = null }: Overrides = {}): string {
  return renderToStaticMarkup(
    <ModelThinkingPicker
      model={model}
      models={null}
      level={level}
      levels={levels ?? model?.thinkingLevels ?? null}
      loading={false}
      onRequest={noop}
      onSelectModel={noop}
      onSelectThinking={noop}
    />,
  );
}

/**
 * The collapsed trigger is what a static render can speak for; the card itself
 * is interaction, and the other popovers over the composer have no component
 * test either. What is asserted here is the decision that comes *before* any
 * click: what the control names, and whether it claims an effort at all.
 */
describe("ModelThinkingPicker", () => {
  it("falls back to the choose prompt before a model is known", () => {
    const markup = render({ model: null, levels: null });
    expect(markup).toContain("选择模型");
  });

  it("names the model and the effort in effect", () => {
    const markup = render({ level: "high" });
    expect(markup).toContain("模型：DeepSeek V3");
    expect(markup).toContain(">DeepSeek V3<");
    expect(markup).toContain(">高<");
  });

  it("stays silent about effort for a model that cannot think", () => {
    // One stop is not a choice; naming it would dress a fixed setting up as a
    // setting the user made.
    const markup = render({
      model: { ...DEEPSEEK, reasoning: false, thinkingLevels: ["off"] },
      level: "off",
    });
    expect(markup).toContain(">DeepSeek V3<");
    expect(markup).not.toContain(">关闭<");
  });

  it("does not name a stop when nothing has recorded a level", () => {
    // The ladder is known, but the session has no level on disk. Parking the
    // readout on the first stop would claim a choice the user never made.
    const markup = render({ level: null });
    expect(markup).toContain(">DeepSeek V3<");
    expect(markup).not.toContain(">关闭<");
    expect(markup).not.toContain(">低<");
  });

  it("keeps a recorded level visible even while the ladder is unknown", () => {
    const markup = render({ level: "max", levels: null });
    expect(markup).toContain("模型：DeepSeek V3");
    expect(markup).toContain(">最高<");
  });

  it("names the model without a provider badge", () => {
    // The trigger used to carry the provider's initial in a tinted square. The
    // model row below and the card's own text both name the provider, so it
    // only repeated what the reader had already been told.
    const markup = render({ level: "high" });
    expect(markup).toContain(">DeepSeek V3<");
    expect(markup).not.toContain(">D</span>");
  });
});
