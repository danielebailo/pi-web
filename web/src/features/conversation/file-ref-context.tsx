import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { FileRef } from "./file-ref.ts";

/**
 * What the transcript can do with a file reference.
 *
 * The renderer (`Markdown.tsx`) owns the *spelling* of a reference and knows
 * nothing about the workspace; this is the other half. `resolve` is the turn's
 * vocabulary of real files — it answers "does this token name one, and which?" —
 * and `open` is the right sidebar. Keeping them here rather than as props is what
 * lets `Markdown` stay a plain renderer and keep its seven other call sites
 * unchanged.
 *
 * A provider is deliberately optional: outside a conversation (the plan preview,
 * a README in the sidebar) there is no vocabulary to resolve against and nothing
 * to open, so a reference stays ordinary text.
 */
export interface FileRefDelegate {
  /**
   * Resolve one inline-code token.
   * @param token - The code span's text, exactly as authored.
   * @returns The reference, spelled as the real file is spelled, or undefined
   * when the token names no file this turn knows — it then stays inert code.
   */
  resolve(token: string): FileRef | undefined;
  /** Open a reference: focus the file in the right sidebar, at its lines. */
  open(ref: FileRef): void;
  /**
   * The URL that shows one path as a picture, when this deployment can serve it.
   *
   * Optional, and the reason it is here rather than in the renderer: what counts
   * as an image, and where its bytes come from, is the owner's business — the
   * transcript knows only that a reference should be able to show what it points
   * at. Returning undefined leaves the chip without a hover preview, which is
   * what every non-image and every non-conversation reader gets.
   */
  imageUrl?: (path: string) => string | undefined;
}

const FileRefContext = createContext<FileRefDelegate | null>(null);

/**
 * Scope file-reference opening to one turn.
 *
 * One provider per turn rather than one per transcript, because the vocabulary
 * *is* per turn — the files a turn touched are the only ones its prose can name
 * without guessing. The delegate must be referentially stable for its turn; a
 * new object per render would defeat the memo on every message that carries one.
 *
 * @param props - The turn's delegate and the rows it applies to.
 * @returns the scoped children.
 */
export function FileRefProvider({
  delegate,
  children,
}: {
  delegate: FileRefDelegate;
  children: ReactNode;
}) {
  const value = useMemo(() => delegate, [delegate]);
  return <FileRefContext.Provider value={value}>{children}</FileRefContext.Provider>;
}

/** The nearest turn's file vocabulary, or null outside a conversation. */
export function useFileRefs(): FileRefDelegate | null {
  return useContext(FileRefContext);
}
