import { useEffect, useRef } from "react";
import clsx from "clsx";
import { FileIcon, FolderIcon } from "../../components/icons.tsx";
import type { FileSearchItem } from "../../lib/types.ts";
import type { Translate } from "../../lib/i18n/index.ts";
import { useT } from "../../lib/app-state.ts";
import menuStyles from "./Menu.module.css";
import styles from "./FileMenu.module.css";

export interface FileMenuProps {
  matches: FileSearchItem[];
  /** True while the query under the caret is still in flight. */
  loading: boolean;
  /** Why the last search failed, if it did. */
  error?: string | null;
  /** Entries the project index holds; `null` while unknown, `0` when empty. */
  indexed?: number | null;
  highlight: number;
  onHighlight(index: number): void;
  onSelect(item: FileSearchItem): void;
}

/** The path in front of a file's own name, trailing separator included. */
function parentOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at + 1);
}

/**
 * What an empty menu has to say.
 *
 * Four different situations end with nothing to list, and only one of them is
 * about the query: a search that failed is a setup problem (a server process
 * running older code, a project directory that has gone), and a project whose
 * index holds nothing has nothing to complete from. Saying "no matching files"
 * for either of those sends the reader looking in the wrong place.
 */
function emptyMessage(
  t: Translate,
  loading: boolean,
  error: string | null | undefined,
  indexed: number | null | undefined,
): string {
  if (error) return `${t("file.failed")}：${error}`;
  if (loading) return t("file.searching");
  if (indexed === 0) return t("file.emptyProject");
  return t("file.empty");
}

/**
 * Candidate list for an in-progress `@file`, rendered above the composer.
 *
 * Unlike the `/` menu there are no sections to group by — a search result is a
 * ranking, and regrouping it would fight the order the server worked out. What
 * the rows do carry is the shape of a path: the name the query reached, and the
 * directory it lives in as a grey column, because two files named `index.ts`
 * are told apart by nothing else. `title` is the whole path, for the row that
 * is still ambiguous.
 *
 * Directories are drawn with a trailing separator and their own icon, which is
 * also the whole of what says "picking this does not close the menu": the
 * separator is what the insert will write.
 */
export function FileMenu({ matches, loading, error, indexed, highlight, onHighlight, onSelect }: FileMenuProps) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation must not scroll the highlighted row out of view. Also
  // keyed on the list itself: a fresh answer resets the highlight to the top,
  // and the viewport is still scrolled to wherever the last one left it.
  useEffect(() => {
    viewportRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, matches]);

  return (
    <div className={menuStyles.menu} role="listbox" aria-label={t("file.menu")}>
      <div className={menuStyles.viewport} ref={viewportRef}>
        {matches.length === 0 ? (
          <div className={menuStyles.empty}>{emptyMessage(t, loading, error, indexed)}</div>
        ) : (
          matches.map((item, index) => (
            <button
              key={`${item.type}:${item.path}`}
              type="button"
              role="option"
              aria-selected={index === highlight}
              data-active={index === highlight}
              className={clsx(menuStyles.item, index === highlight && menuStyles.itemActive)}
              title={item.path}
              onMouseEnter={() => onHighlight(index)}
              // mousedown, not click: by click time the textarea has already
              // blurred and the caret position is gone.
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              <span className={styles.icon}>
                {item.type === "directory"
                  ? <FolderIcon width={14} height={14} />
                  : <FileIcon width={14} height={14} />}
              </span>
              <span className={styles.name}>
                {item.name}
                {item.type === "directory" ? "/" : ""}
              </span>
              {item.path === item.name ? null : (
                <span className={styles.directory}>{parentOf(item.path)}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
