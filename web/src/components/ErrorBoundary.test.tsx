import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translator } from "../lib/i18n/index.ts";
import { ErrorBoundary, ErrorPanel } from "./ErrorBoundary.tsx";

// The copy resolves through `useT`, and the default `system` preference lands on
// English without a navigator (node test environment). The assertions below pin
// the Chinese wording, so fix the host locale here.
vi.stubGlobal("navigator", { language: "zh-CN" });

const t = translator("zh-CN");
const noop = (): void => {};

/**
 * The boundary, seen from outside.
 *
 * A static render cannot catch anything — `componentDidCatch` needs a real
 * commit — so what is covered here is the two halves that are reachable without
 * arranging a throw: the children pass through untouched, and the panel itself
 * says which scope failed. The catching path is a handful of lines around
 * React's own contract, and the panel is what a reader actually sees.
 */
describe("ErrorBoundary", () => {
  it("draws its children when nothing throws", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(html).toContain("<p>fine</p>");
  });
});

describe("ErrorPanel", () => {
  const error = new Error("boom");

  it("says the page failed and offers both ways out", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel error={error} onRetry={noop} scope="app" t={t} />,
    );
    expect(html).toContain("这个页面出错了");
    expect(html).toContain("重试");
    expect(html).toContain("重新载入页面");
  });

  it("names the panel rather than the page when only a pane was lost", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel error={error} onRetry={noop} scope="pane" t={t} />,
    );
    expect(html).toContain("这个面板出错了");
  });

  it("keeps the stack one click away", () => {
    const html = renderToStaticMarkup(
      <ErrorPanel error={error} onRetry={noop} scope="app" t={t} />,
    );
    expect(html).toContain("错误详情");
    expect(html).toContain("boom");
  });
});
