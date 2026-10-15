import type { ChangeEvent, KeyboardEvent } from "react";
import card from "./QuestionCard.module.css";

/**
 * The free-text answer field, mirror-grown so a long answer never scrolls its
 * own box empty.
 *
 * Shared by the batched question card and the plan review: a batch answer is a
 * line or two, and so is a change request. The editor's multiline sizing is not
 * used here — the mirror does that job — which is what keeps the two surfaces
 * one field instead of two lookalikes.
 */
export function AnswerField({
  value,
  placeholder,
  disabled,
  onChange,
  onKeyDown,
  ...rest
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  "data-focus-first"?: string;
}) {
  return (
    <div className={card.field}>
      <div aria-hidden className={card.fieldMirror}>{`${value}\n`}</div>
      <textarea
        {...rest}
        className={card.fieldInput}
        value={value}
        rows={1}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
