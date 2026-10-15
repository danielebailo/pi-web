/**
 * The session rows the sidebar draws, in order.
 *
 * Both the renderer and the drag-and-drop handler call these: a workspace's
 * drop has to reorder exactly the rows that are on screen, so the two sides have
 * to agree on which rows survive the search filter and the revealed-page cut,
 * and on the order the current arrangement puts them in.
 */
import { SESSIONS_PAGE_SIZE, type AppState } from "../../lib/app-state.ts";
import { FLAT_ORDER_KEY, orderSessions } from "../../lib/sidebar-view.ts";
import type { SessionView } from "../../lib/types.ts";

/** A workspace's rows: pending drafts first, then the ordered page. */
export interface SessionRows {
  /**
   * Rows this browser created that pi has not written to disk yet, newest
   * first. They lead the workspace and are not draggable: dsh pins its blank
   * session the same way, and a row with no file has no position to save.
   */
  drafts: string[];
  /** The ordered page, capped unless the list is being searched. */
  sessions: SessionView[];
  /** The size of the page that was asked for; "show more" adds one more to it. */
  limit: number;
  /** How many rows the workspace still holds beyond `sessions`. */
  remaining: number;
  /**
   * True while this workspace's first page is still on its way.
   *
   * The sidebar draws a workspace's rows from `state.sessions[projectId]`
   * alone, so a list that has not arrived yet and one that is genuinely empty
   * have the same shape. This is the difference between "还没有会话。" and a
   * hint that the wait is a wait — see `sessionsLoading` in the app state.
   */
  loading: boolean;
}

/**
 * Whether one workspace's *first* page of sessions is still being fetched.
 *
 * A page that came back empty is a settled answer, not a pending one: the
 * project has an entry in `sessions` either way, and only a project with no
 * entry at all is still waiting. That is also why a reload behind rows already
 * on screen never reaches this: the entry is there, so nothing is "awaiting".
 */
function awaitingFirstPage(state: AppState, projectId: string): boolean {
  return state.sessionsLoading[projectId] === true && state.sessions[projectId] === undefined;
}

/**
 * What one workspace shows.
 *
 * Hidden sessions are dropped: the server already leaves them out of the list
 * it answers with, so this is the client-side half of the same rule.
 */
export function sessionRowsOf(state: AppState, projectId: string): SessionRows {
  const listed = state.sessions[projectId];
  const all = listed ?? [];
  const visible = all.filter((session) => !session.hidden);
  const query = state.sessionQuery.trim().toLowerCase();
  const searching = query.length > 0;
  const matched = searching
    ? visible.filter((session) => session.title.toLowerCase().includes(query))
    : visible;
  const view = state.sidebarView;
  const ordered = view.orderBy === "manual"
    ? orderSessions(matched, view.sessionOrder[projectId])
    : matched;
  // A search filters titles on the client and so asks the server for the whole
  // list; anything short of that is capped by the revealed-page count.
  const limit = searching
    ? ordered.length
    : (state.revealedSessions[projectId] ?? SESSIONS_PAGE_SIZE);
  const sessions = ordered.slice(0, limit);
  const remaining = searching
    ? ordered.length - sessions.length
    : Math.max(0, (state.sessionTotals[projectId] ?? all.length) - sessions.length);
  const drafts = (state.unsavedSessions[projectId] ?? []).filter(
    (path) => !all.some((session) => session.path === path),
  );
  return { drafts, sessions, limit, remaining, loading: awaitingFirstPage(state, projectId) };
}

/** One flat list's rows: every workspace's drafts, then every session. */
export interface FlatRows {
  /** Pending drafts, newest first. */
  drafts: string[];
  /** Every loaded session, in the current order. */
  sessions: SessionView[];
  /** True while any workspace's first page is still on its way; this list asks
   * every one of them, so its empty state waits on the first to answer. */
  loading: boolean;
}

/**
 * What the one-list grouping shows.
 *
 * The workspaces' pages arrive newest-first each; merging them means ordering
 * the whole set again, by recency or by the list's own saved arrangement. That
 * arrangement is its own account (`FLAT_ORDER_KEY`) rather than a merge of the
 * per-workspace ones: a session dragged here is being placed in this list, and
 * dsh keeps the flat list's order in a browser-local account of its own for the
 * same reason.
 */
export function flatSessionRowsOf(state: AppState): FlatRows {
  const rows: SessionView[] = [];
  for (const project of state.projects) {
    for (const session of state.sessions[project.id] ?? []) {
      if (!session.hidden) rows.push(session);
    }
  }
  const query = state.sessionQuery.trim().toLowerCase();
  const matched = query.length > 0
    ? rows.filter((session) => session.title.toLowerCase().includes(query))
    : rows;
  const view = state.sidebarView;
  const sessions = view.orderBy === "manual"
    ? orderSessions(matched, view.sessionOrder[FLAT_ORDER_KEY])
    : [...matched].sort((a, b) => b.modified.localeCompare(a.modified));

  const drafts: string[] = [];
  for (const project of state.projects) {
    const all = state.sessions[project.id] ?? [];
    for (const path of state.unsavedSessions[project.id] ?? []) {
      if (!all.some((session) => session.path === path)) drafts.push(path);
    }
  }
  return {
    drafts,
    sessions,
    loading: state.projects.some((project) => awaitingFirstPage(state, project.id)),
  };
}
