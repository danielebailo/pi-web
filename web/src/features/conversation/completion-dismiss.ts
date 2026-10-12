/**
 * The sigil-anchored identity of a completion token: where the sigil (`/` or
 * `@`) sits and what has been typed after it.
 *
 * Both `SlashTrigger` and `AtTrigger` carry exactly this, so the rules below
 * are shared by the two completions without either importing the other.
 */
export interface TokenAnchor {
  /** Text between the sigil and the caret. */
  query: string;
  /** Index of the sigil within the textarea's value. */
  start: number;
}

/** Two anchors name the same token only when both its position and query match. */
function sameAnchor(a: TokenAnchor | null, b: TokenAnchor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.query === b.query;
}

/** The two pieces of state a re-sync produces. */
export interface CompletionResync {
  /** The token a dismissal sticks to, or null when nothing is suppressed. */
  dismissed: TokenAnchor | null;
  /** The token to complete on now, or null when none is live. */
  trigger: TokenAnchor | null;
}

/**
 * Re-read a textarea and decide what the completion menu should do next, using
 * dsh's dismissal rules (`packages/client/ui-input-trigger/.../controller.ts`):
 *
 * - A dismissal means "not this one, not now". It holds while the very token it
 *   named — same sigil position, same query — is re-tracked, so the `keyup`
 *   that follows an Escape cannot put the menu straight back.
 * - Anything else re-arms it: typing a new query, moving to another token, or
 *   erasing the token. The last case is the one worth naming — with the token
 *   gone the dismissal has nothing left to describe, so clearing it is what
 *   lets a `/` typed again open the menu. Skipping that clear leaves a stale
 *   veto behind and the second `/` is silenced forever.
 */
export function resolveCompletion(
  current: TokenAnchor | null,
  dismissed: TokenAnchor | null,
  next: TokenAnchor | null,
): CompletionResync {
  if (dismissed !== null) {
    if (sameAnchor(dismissed, next)) return { dismissed, trigger: current };
    dismissed = null;
  }
  if (sameAnchor(current, next)) return { dismissed, trigger: current };
  return { dismissed, trigger: next };
}
