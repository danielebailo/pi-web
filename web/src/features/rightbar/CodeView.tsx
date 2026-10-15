import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import clsx from "clsx";
import { getGrammarVersion, highlightLines, subscribeLanguages } from "../conversation/highlight.ts";
import styles from "./CodeView.module.css";

/**
 * A file's text, one DOM row per line, so a reference can point into it.
 *
 * `CodeBlock` draws a whole file as one highlighted block, which is the right
 * shape for reading and the wrong one for landing in: a line number cannot be
 * scrolled to unless the line exists as an element. This draws the rows and
 * leaves them plain — the syntax colouring `CodeBlock` does arrives with a
 * grammar chunk, and a preview that has been asked to show line 240 of a log is
 * not the place to wait for one.
 *
 * Wrapping is off and the rows scroll sideways, matching `.text` in the preview
 * pane: a wrapped line has no line number a reader can trust, and every editor
 * the reference's number came from counts unwrapped lines.
 */
export function CodeView({
  code,
  lang,
  firstLine = 1,
  focusLine,
  focusEndLine,
  gutter = true,
}: {
  /** The whole file, as read. A trailing newline does not make an empty last row. */
  code: string;
  /** The language as the file's name implies it; absent draws plain text. */
  lang?: string | undefined;
  /**
   * The file line `code`'s first line is.
   *
   * A whole file starts at 1; a page of a long one starts wherever the server
   * said, and the numbers — the gutter, `data-line`, and the reference's target
   * — are all file lines either way, so a caller never has to translate.
   */
  firstLine?: number;
  /** File line to reveal, if the reference asked for one. */
  focusLine?: number | undefined;
  /** Last file line of the highlighted range; equal to `focusLine` for one line. */
  focusEndLine?: number | undefined;
  /** Whether to draw the line-number column. */
  gutter?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The tokenizer splits on the last newline, so the text and the highlight have
  // to agree about where lines end; a trailing newline would otherwise be one
  // more line than the source has.
  const body = useMemo(() => code.replace(/\n$/, ""), [code]);
  const lines = useMemo(() => body.split("\n"), [body]);
  // The number column is as wide as the largest number it will print, so the
  // text does not shift sideways when the file is long enough to gain a digit.
  const lastLine = firstLine + lines.length - 1;
  const width = `${String(lastLine).length + 1}ch`;

  /**
   * One coloured fragment per line, or `null` to keep the plain text.
   *
   * Read through the grammar store because every language but the three in the
   * entry chunk arrives as a dynamic import: the first paint is plain text and
   * the store re-renders this when the grammar lands. `null` is also what a file
   * past `MAX_HIGHLIGHT_LENGTH` gets, and what a line past shiki's own length
   * guard produces — in every case the honest answer is the text that is already
   * on screen, with colour as the upgrade that did not arrive.
   */
  const grammarVersion = useSyncExternalStore(subscribeLanguages, getGrammarVersion, getGrammarVersion);
  const painted = useMemo(
    () => (lang === undefined ? null : highlightLines(body, lang)),
    [body, lang, grammarVersion],
  );

  useEffect(() => {
    if (focusLine === undefined) return;
    // `block: "center"` puts the line in the middle of the pane rather than at
    // its edge, which is what makes a reference read as "here it is" instead of
    // "the file starts around here". `inline: "nearest"` keeps a long line from
    // also scrolling the pane sideways to its own end.
    rootRef.current
      ?.querySelector(`[data-line="${String(focusLine)}"]`)
      ?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [focusLine, lines]);

  return (
    <div className={clsx(styles.view, gutter && styles.numbered)} ref={rootRef} data-code-view>
      {lines.map((text, index) => {
        const number = firstLine + index;
        const focused =
          focusLine !== undefined && number >= focusLine && number <= (focusEndLine ?? focusLine);
        const coloured = painted?.[index];
        return (
          <div
            key={number}
            className={styles.row}
            data-line={number}
            data-focus={focused || undefined}
          >
            {gutter ? (
              <span className={styles.gutter} style={{ width }} aria-hidden>
                {number}
              </span>
            ) : null}
            {/* A line the tokenizer had nothing to say about keeps its own text;
             * an empty one still needs height, which the gutter provides. */}
            {coloured === undefined ? (
              <span className={styles.text}>{text === "" ? "\u00a0" : text}</span>
            ) : (
              <span className={styles.text} dangerouslySetInnerHTML={{ __html: coloured }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
