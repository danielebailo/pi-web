import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { appStore, resetAppState } from "../../lib/app-state.ts";
import { FileMenu, type FileMenuProps } from "./FileMenu.tsx";

// The menu renders whatever language the settings resolve to, and a test host
// has no locale to resolve (`resolveLanguage` falls back to English). Pinning
// the preference keeps the assertions about the copy itself.
beforeEach(() => {
  resetAppState();
  appStore.update((state) => ({ ...state, settings: { ...state.settings, language: "zh-CN" } }));
});

const noop = (): void => undefined;

const html = (props: Partial<FileMenuProps>): string =>
  renderToStaticMarkup(
    <FileMenu matches={[]} loading={false} highlight={0} onHighlight={noop} onSelect={noop} {...props} />,
  );

/**
 * An empty menu is four different situations, and the wording has to separate
 * them: only one is about what the user typed. The rest are setup problems —
 * a server that is not answering, a project with nothing in it — and telling
 * the reader "no matching files" for those sends them looking in the wrong
 * place.
 */
describe("FileMenu empty states", () => {
  it("reports a failed search instead of an empty one", () => {
    const markup = html({ error: "项目目录不存在：/tmp/gone" });
    expect(markup).toContain("搜索文件失败");
    expect(markup).toContain("项目目录不存在");
    expect(markup).not.toContain("没有匹配的文件");
  });

  it("says a project has nothing to complete from", () => {
    const markup = html({ indexed: 0 });
    expect(markup).toContain("没有可补全的文件");
  });

  it("says the query matched nothing", () => {
    const markup = html({ indexed: 12 });
    expect(markup).toContain("没有匹配的文件");
  });

  it("says it is still searching", () => {
    expect(html({ loading: true })).toContain("正在搜索文件");
  });

  it("lists a candidate by its own name and its directory", () => {
    const markup = html({
      indexed: 1,
      matches: [{ path: "src/lib/api.ts", name: "api.ts", type: "file" }],
    });
    expect(markup).toContain("api.ts");
    expect(markup).toContain("src/lib/");
    expect(markup).not.toContain("没有匹配的文件");
  });

  it("marks a directory with the separator an insert will write", () => {
    const markup = html({ indexed: 1, matches: [{ path: "src/lib", name: "lib", type: "directory" }] });
    expect(markup).toContain("lib/");
  });
});
