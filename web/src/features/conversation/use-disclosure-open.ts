import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/**
 * Open state for a disclosure row whose starting position comes from the
 * display mode.
 *
 * The verbose display shows the work instead of a title for it, so the mode
 * seeds every process row open; a click then overrides that and the reader's
 * choice stands until the mode changes again, which resets the row to the new
 * mode's default. Sharing the effect keeps the four rows that render through
 * `DisclosureRow` — a thinking block, a tool call, a todo panel, a question
 * card — from each spelling out the same synchronization.
 */
export function useDisclosureOpen(
  defaultOpen: boolean,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);
  return [open, setOpen];
}
