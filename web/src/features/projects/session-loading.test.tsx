import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hint waits before it appears (`use-delayed-flag.ts`), and effects do not
// run under `renderToStaticMarkup` — the real hook would still be on its first
// frame here, so every render below would draw the empty state and these
// assertions could not tell the two apart. Reporting `active` immediately is
// what puts the row the user eventually gets into the markup; the delay itself
// is the same one the transcript's hint uses, and is not what is under test.
vi.mock("../../lib/use-delayed-flag.ts", () => ({
  useDelayedFlag: (active: boolean) => active,
}));

// These assertions name the copy, so fix the host locale for the file.
vi.stubGlobal("navigator", { language: "zh-CN" });
import { appStore, resetAppState, type AppState } from "../../lib/app-state.ts";
import type { ProjectNode } from "../../lib/project-tree.ts";
import type { ProjectView, SessionView } from "../../lib/types.ts";
import { FlatSessionList } from "./FlatSessionList.tsx";
import { ProjectTreeItem } from "./ProjectTree.tsx";
import { NO_DRAG } from "./use-sidebar-drag.ts";

function project(id: string): ProjectView {
  return {
    id,
    path: `/Users/dev/${id}`,
    title: id,
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    exists: true,
  };
}

function session(path: string, title: string): SessionView {
  return {
    path,
    id: path,
    cwd: "/Users/dev/proj",
    title,
    titleSource: "session",
    preview: "",
    created: "2026-01-04T00:00:00.000Z",
    modified: "2026-01-04T00:00:00.000Z",
    messageCount: 1,
    hidden: false,
  };
}

const REAL = session("/s/a.jsonl", "alpha");

function seed(overrides: Partial<AppState> = {}): void {
  appStore.set({
    ...appStore.get(),
    projects: [project("p1")],
    expandedProjects: { p1: true },
    sessions: {},
    sessionTotals: {},
    unsavedSessions: {},
    sessionQuery: "",
    ...overrides,
  });
}

beforeEach(() => {
  resetAppState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("navigator", { language: "zh-CN" });
});

/**
 * What a workspace draws before its first page arrives.
 *
 * A workspace holding a hundred sessions used to draw "还没有会话。" for as long
 * as the server took to walk them — most of a second, on the first expansion in
 * a server's life. The hint is only for that wait: an answer that came back
 * empty settles the question, and a workspace that already has rows keeps
 * drawing them while its reload runs.
 */
describe("the sidebar while a workspace's first page is in flight", () => {
  const node = (): ProjectNode => ({ project: project("p1"), children: [], depth: 0 });

  it("names the wait instead of claiming the workspace is empty", () => {
    seed({ sessionsLoading: { p1: true } });

    const html = renderToStaticMarkup(<ProjectTreeItem node={node()} />);

    expect(html).toContain("正在载入会话列表…");
    expect(html).not.toContain("还没有会话");
  });

  it("draws the empty state once an empty page has landed", () => {
    // The workspace has been listed and holds nothing: the wait is over, and
    // the mark left over from it must not keep the hint on screen.
    seed({ sessions: { p1: [] }, sessionsLoading: { p1: true } });

    const html = renderToStaticMarkup(<ProjectTreeItem node={node()} />);

    expect(html).toContain("还没有会话");
    expect(html).not.toContain("正在载入会话列表…");
  });

  it("does not hint at a workspace nobody asked about", () => {
    seed();

    const html = renderToStaticMarkup(<ProjectTreeItem node={node()} />);

    expect(html).toContain("还没有会话");
  });

  it("keeps drawing the rows a reload is running behind", () => {
    seed({ sessions: { p1: [REAL] }, sessionTotals: { p1: 1 }, sessionsLoading: { p1: true } });

    const html = renderToStaticMarkup(<ProjectTreeItem node={node()} />);

    expect(html).toContain("alpha");
    expect(html).not.toContain("正在载入会话列表…");
  });

  it("waits in the one-list grouping too", () => {
    // The flat list asks every workspace at once, so its empty state waits on
    // the first of them rather than deciding on an empty merge.
    seed({ sessionsLoading: { p1: true } });

    const html = renderToStaticMarkup(<FlatSessionList drag={NO_DRAG} />);

    expect(html).toContain("正在载入会话列表…");
    expect(html).not.toContain("还没有会话");
  });

  it("stops waiting in the one-list grouping once the pages have landed", () => {
    seed({ sessions: { p1: [] }, sessionsLoading: { p1: true } });

    const html = renderToStaticMarkup(<FlatSessionList drag={NO_DRAG} />);

    expect(html).toContain("还没有会话");
    expect(html).not.toContain("正在载入会话列表…");
  });
});
