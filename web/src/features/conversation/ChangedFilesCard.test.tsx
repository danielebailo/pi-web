import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChangedFilePreview, ChangedFilesCard } from "./ChangedFilesCard.tsx";
import type { TurnFile } from "./turn-files.ts";

// The card renders through `useT`, and the default `system` preference resolves
// to English when there is no navigator (this runs in the node environment). The
// assertions below are about the Chinese copy, so pin the host locale.
vi.stubGlobal("navigator", { language: "zh-CN" });

function file(display: string, overrides: Partial<TurnFile> = {}): TurnFile {
  return {
    path: `/proj/${display}`,
    relative: display,
    display,
    added: 1,
    deleted: 0,
    patches: [],
    oversized: false,
    ...overrides,
  };
}

const noop = (): void => {};

/**
 * Static covers for the card.
 *
 * The card is a list plus one piece of arithmetic (the fold), and the arithmetic
 * is the part that can be wrong without looking wrong — so it is asserted at the
 * boundary (four rows shown, five folded) rather than through clicks, which a
 * static render cannot make anyway.
 */
describe("ChangedFilesCard", () => {
  it("shows every row when the turn fits under the fold", () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard
        files={[file("a.ts"), file("b.ts"), file("c.ts", { added: 0, deleted: 1 })]}
        turn={1}
        onOpenChanges={noop}
      />,
    );

    expect(html).toContain("已编辑 3 个文件");
    expect(html).toContain("a.ts");
    expect(html).toContain("b.ts");
    // The header totals every file's counts; a row carries its own.
    expect(html).toContain("+2");
    expect(html).toContain("-1");
    // Nothing hidden: no fold control to click.
    expect(html).not.toContain("全部");
  });

  it("folds past the fourth row and says how many are hidden", () => {
    const files = ["a", "b", "c", "d", "e"].map((name) => file(`${name}.ts`));
    const html = renderToStaticMarkup(
      <ChangedFilesCard files={files} turn={1} onOpenChanges={noop} />,
    );

    expect(html).toContain("已编辑 5 个文件");
    expect(html).toContain("d.ts");
    expect(html).not.toContain("e.ts");
    expect(html).toContain("全部 5 个文件");
    expect(html).toContain("展开全部 5 个改动文件");
  });

  it("keeps a one-file turn to its header", () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard
        files={[file("src/a.ts", { added: 4, deleted: 2 })]}
        turn={1}
        onOpenChanges={noop}
      />,
    );

    // dsh names the file instead of counting to one, and draws no list beside it.
    expect(html).toContain("已编辑 a.ts");
    expect(html).not.toContain("已编辑 1 个文件");
    expect(html).not.toContain("<ul");
    expect(html).toContain('data-single="true"');
    expect(html).toContain("+4");
    expect(html).toContain("-2");
  });

  it("makes every row reviewable, and opens on the first file from the header", () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard files={[file("src/a.ts"), file("src/b.ts")]} turn={1} onOpenChanges={noop} />,
    );

    expect(html).toContain("在右侧栏查看 src/a.ts 的改动");
    expect(html).toContain("在右侧栏查看 src/b.ts 的改动");
    expect(html).toContain("在右侧栏查看本轮改动");
  });

  it("still opens a file outside the project: its patch is in the transcript too", () => {
    const outside = file("/tmp/notes.md", { relative: null });
    const html = renderToStaticMarkup(
      <ChangedFilesCard files={[outside, file("a.ts")]} turn={1} onOpenChanges={noop} />,
    );

    expect(html).toContain("/tmp/notes.md");
    expect(html).toContain("在右侧栏查看 /tmp/notes.md 的改动");
  });

  it("draws the card without a handler as plain, unclickable rows", () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard files={[file("a.ts"), file("b.ts")]} turn={1} />,
    );

    expect(html).toContain("已编辑 2 个文件");
    expect(html).not.toContain("在右侧栏查看 a.ts 的改动");
    expect(html).not.toContain("在右侧栏查看本轮改动");
  });

  it("says 过大 for a call whose content the transcript cannot measure", () => {
    const html = renderToStaticMarkup(
      <ChangedFilesCard
        files={[file("big.bin", { added: 0, oversized: true })]}
        turn={1}
        onOpenChanges={noop}
      />,
    );

    expect(html).toContain("过大");
    expect(html).not.toContain("+0");
  });
});

/**
 * The hover pane, rendered on its own.
 *
 * The card only mounts it after a half-second dwell, which a static render
 * cannot perform (the gesture, including the grace that lets the pointer onto the
 * pane and keeps it there, is covered by the live probe). What can be read here
 * is what the pane says: the call's own patch, numbered the way the panel numbers
 * it, or the reason there is no patch to draw.
 */
describe("ChangedFilePreview", () => {
  it("draws the call's patch through the panel's numbered rows, without the hunk header", () => {
    const html = renderToStaticMarkup(
      <ChangedFilePreview
        file={file("src/a.ts", { patches: ["@@ -10,1 +20,1 @@\n-old\n+new\n"] })}
        onEnter={noop}
        onLeave={noop}
      />,
    );

    expect(html).toContain("src/a.ts");
    expect(html).toContain("new");
    // The numbers come from the hunk's own range, which only the shared row
    // renderer can say.
    expect(html).toContain(">20<");
    expect(html).not.toContain("@@");
  });

  it("names the reason instead of opening an empty pane", () => {
    const oversized = renderToStaticMarkup(
      <ChangedFilePreview
        file={file("big.bin", { added: 0, oversized: true })}
        onEnter={noop}
        onLeave={noop}
      />,
    );
    expect(oversized).toContain("文件过大，无法显示改动");

    // No patch and nothing oversized: a call whose result the transcript does
    // not carry (an `edit` read back from a trimmed log).
    const unmeasurable = renderToStaticMarkup(
      <ChangedFilePreview file={file("a.ts")} onEnter={noop} onLeave={noop} />,
    );
    expect(unmeasurable).toContain("这次调用没有可显示的改动");
  });
});
