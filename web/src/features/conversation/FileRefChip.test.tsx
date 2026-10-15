import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileRefProvider, type FileRefDelegate } from "./file-ref-context.tsx";
import { Markdown } from "./Markdown.tsx";
import type { FileRef } from "./file-ref.ts";

const OPENER = () => undefined;

/** A delegate that knows exactly the tokens a test lists, as a turn's does. */
function delegateOf(known: Record<string, FileRef>): FileRefDelegate {
  return { resolve: (token) => known[token], open: OPENER };
}

function render(text: string, options: { refs?: FileRefDelegate; streaming?: boolean } = {}): string {
  const markdown = (
    <Markdown text={text} {...(options.streaming === undefined ? {} : { streaming: options.streaming })} />
  );
  return renderToStaticMarkup(
    options.refs === undefined ? markdown : <FileRefProvider delegate={options.refs}>{markdown}</FileRefProvider>,
  );
}

describe("Markdown file references", () => {
  it("turns a link to a workspace file into a chip that opens it", () => {
    const html = render("[the loader](src/app.ts#L24-L30)", { refs: delegateOf({}) });
    expect(html).toContain('data-file-ref="src/app.ts"');
    expect(html).toContain('data-file-line="24"');
    expect(html).toContain("the loader");
    // The chip is the app's own navigation, not a new browser tab.
    expect(html).not.toContain("<a ");
  });

  it("falls back to the file's own name when the label is empty", () => {
    expect(render("[](src/app.ts#L7)", { refs: delegateOf({}) })).toContain("app.ts:7");
  });

  it.each([
    ["[site](https://example.com/)", "an absolute URL"],
    ["[mail](mailto:a@b.c)", "another scheme"],
    ["[line](src/app.ts#L0)", "a line zero"],
  ])("keeps %s a plain external link (%s)", (text) => {
    const html = render(text, { refs: delegateOf({}) });
    expect(html).toContain("<a ");
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("data-file-ref");
  });

  it("leaves a local link alone when no vocabulary is in scope", () => {
    const html = render("[the loader](src/app.ts#L24)");
    expect(html).toContain("<a ");
    expect(html).not.toContain("data-file-ref");
  });

  it("turns an inline-code token the turn knows into a chip", () => {
    const html = render("see `useConversation.ts:396` for the send loop", {
      refs: delegateOf({ "useConversation.ts:396": { path: "src/features/conversation/useConversation.ts", line: 396, endLine: 396 } }),
    });
    expect(html).toContain('data-file-ref="src/features/conversation/useConversation.ts"');
    expect(html).toContain("useConversation.ts:396");
    expect(html).not.toContain("<code");
  });

  it("leaves a token the turn never named as code", () => {
    const html = render("see `index.ts` here", { refs: delegateOf({}) });
    expect(html).toContain("<code");
    expect(html).not.toContain("data-file-ref");
  });

  it("leaves code alone with no vocabulary, which is every non-conversation reader", () => {
    expect(render("see `src/app.ts:12` here")).toContain("<code");
  });

  it("chips nothing while the message is still streaming", () => {
    const refs = delegateOf({ "src/app.ts:12": { path: "src/app.ts", line: 12, endLine: 12 } });
    const html = render("see `src/app.ts:12` and [it](src/app.ts#L12)", { refs, streaming: true });
    expect(html).not.toContain("data-file-ref");
    expect(html).toContain("<code");
    expect(html).toContain("<a ");
  });

  it("does not chip an inline token inside a link's own label", () => {
    // The label of a reference link is text, and a chip may not nest in an
    // anchor — the renderer keeps the mention inert there.
    const html = render("[see `src/app.ts`](https://example.com/)", {
      refs: delegateOf({ "src/app.ts": { path: "src/app.ts" } }),
    });
    expect(html).toContain("<a ");
    expect(html).not.toContain("data-file-ref");
  });
});
