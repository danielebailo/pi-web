import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../lib/app-state.ts";
import type { Translate } from "../lib/i18n/index.ts";
import { reloadPage } from "../lib/stale-chunk.ts";
import { AlertIcon } from "./icons.tsx";
import styles from "./ErrorBoundary.module.css";

/**
 * The net under every render.
 *
 * React's rule is unforgiving: an error thrown while rendering that no boundary
 * catches unmounts the whole root. In this app that is a blank page — `#root`
 * left empty, the window still up, nothing on screen saying why — and it does
 * not heal on its own. Every failure this project has traced to a blank page
 * was one of these: a hook-count mismatch in the sidebar, and a `React.lazy`
 * chunk that 404s because a build replaced the served directory underneath a
 * long-lived window (see `lib/stale-chunk.ts`). Neither is worth the tree.
 *
 * Two scopes, because the right amount of UI depends on how much was lost. The
 * app-level one stands in for the shell and offers a reload; the pane-level one
 * keeps a single right-side tab from taking the conversation with it.
 */

/** Which slice of the UI the boundary stands in for. */
export type ErrorScope = "app" | "pane";

interface CatcherProps {
  t: Translate;
  scope: ErrorScope;
  children: ReactNode;
}

interface CatcherState {
  error: Error | null;
}

/**
 * The stateful half.
 *
 * A class because that is still the only component kind React lets catch — and
 * because the message it draws needs `t`, which is a hook, so the copy arrives
 * as a prop from the function wrapper below.
 */
class ErrorCatcher extends Component<CatcherProps, CatcherState> {
  override state: CatcherState = { error: null };

  /**
   * Normalize whatever was thrown. React allows a string or any object, and the
   * panel shows a stack, so the two are folded into an `Error` here rather than
   * defended against at every use.
   */
  static getDerivedStateFromError(error: unknown): CatcherState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only record that outlives the panel: React prints the same thing to
    // the console on its own, but it prints it beside an empty page, and the
    // next refresh erases it. The prefix makes both boundaries greppable.
    console.error(`[error-boundary:${this.props.scope}]`, error, info.componentStack);
  }

  private readonly retry = (): void => {
    // The children are remounted, not just re-rendered: whatever they had in
    // flight when they threw is gone, and a stateful child left behind would
    // throw again from the same place. Clearing the error is enough for React
    // to rebuild the subtree under this boundary.
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <ErrorPanel error={error} onRetry={this.retry} scope={this.props.scope} t={this.props.t} />
    );
  }
}

interface ErrorPanelProps {
  t: Translate;
  scope: ErrorScope;
  error: Error;
  /** Clear the caught error so the wrapped subtree is drawn again. */
  onRetry: () => void;
}

/**
 * What a caught error looks like.
 *
 * Exported and separate from the catcher because a boundary's own render only
 * runs after something has already gone wrong — a plain props-in, markup-out
 * component is the only part of this file a test can reach without arranging a
 * throw.
 *
 * The details are folded shut on purpose. A reader who hit this wants one
 * button, and the stack is for whoever they hand the screenshot to; keeping it
 * one click away serves both without a second screen.
 */
export function ErrorPanel({ t, scope, error, onRetry }: ErrorPanelProps) {
  return (
    <div className={styles.panel} data-scope={scope} role="alert">
      <span className={styles.badge} aria-hidden>
        <AlertIcon />
      </span>
      <h2 className={styles.title}>{t(scope === "app" ? "error.title" : "error.paneTitle")}</h2>
      <p className={styles.description}>{t("error.description")}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t("error.retry")}
        </button>
        <button type="button" className={styles.reload} onClick={reloadPage}>
          {t("error.reload")}
        </button>
      </div>
      <details className={styles.details}>
        <summary className={styles.summary}>{t("error.details")}</summary>
        <pre className={styles.stack}>{error.stack ?? `${error.name}: ${error.message}`}</pre>
      </details>
    </div>
  );
}

/**
 * Wrap a subtree so a render error inside it shows a panel instead of clearing
 * the page.
 *
 * `scope` picks the wording; nothing else about the boundary changes. Children
 * are unmounted when it catches and rebuilt on retry, so a child that keeps
 * failing lands back here rather than looping.
 */
export function ErrorBoundary({
  scope = "app",
  children,
}: {
  scope?: ErrorScope;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <ErrorCatcher scope={scope} t={t}>
      {children}
    </ErrorCatcher>
  );
}
