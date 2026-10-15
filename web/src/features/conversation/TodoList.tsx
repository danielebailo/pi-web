import clsx from "clsx";
import { Glyph } from "../../components/dsh-icons.tsx";
import { limitCompleted, type TodoItem, type TodoStatus } from "./todo-model.ts";
import { todoStatusLabel } from "./todo-diff-model.ts";
import styles from "./TodoList.module.css";
import { useT } from "../../lib/app-state.ts";

/**
 * The task rows. Shared by the plan panel above the composer and the todo row
 * inside the transcript, because both surfaces show the same list and two
 * implementations would drift.
 *
 * The mark is the one thing the two surfaces do not share, and the split is
 * dsh's rather than a preference of ours. dsh's panel speaks a compact status
 * language — `StateDot`, a 6px core in a 10px slot, and a 14px breathing ring
 * for the single task that is running — while its details card, the one the
 * transcript's todo row draws, marks a changed line with `+` or `−`, a kept one
 * with a check or play icon, an unstarted one with a hollow square, and spells
 * the status out in words beside it. So the panel passes `marks="stateDot"` and
 * the transcript takes the default `details`.
 */

/** dsh `StateDot`'s solid states: the 10px slot stays empty and a 6px core paints inside it. */
function DotMark({ status }: { status: "completed" | "pending" }) {
  return <span className={styles.dot} data-state={status === "completed" ? "done" : "idle"} />;
}

/** dsh `StateDot`'s ongoing state: one ring, a breathing arc, the whole glyph rotating. */
function SpinnerMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden className={styles.spinner}>
      <g className={styles.spinnerMotion}>
        <circle className={styles.spinnerTrack} cx="12" cy="12" r="9.5" />
        <circle className={styles.spinnerArc} cx="12" cy="12" r="9.5" />
      </g>
    </svg>
  );
}

/** dsh `StateDot`, reduced to the three states a task can be in. */
function StateDotMark({ status }: { status: TodoStatus }) {
  return status === "in_progress" ? <SpinnerMark /> : <DotMark status={status} />;
}

/**
 * dsh's details marks: a check for a finished task, a play ring for the one that
 * is running, a hollow square for one that has not started. Exported for the
 * transcript row, whose `+`/`−` lines share the other three.
 */
export function DetailMark({ status }: { status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <Glyph name="check" />;
    case "in_progress":
      return <Glyph name="play" />;
    case "pending":
      return <span className={styles.pending} />;
  }
}

export function TodoList({
  todos,
  completedLimit,
  marks = "details",
  className,
}: {
  todos: readonly TodoItem[];
  /**
   * Drop all but the newest N finished tasks, with a `+N 项已完成` line for the
   * rest. Only the plan panel passes this: a transcript row shows the snapshot
   * that call returned, and trimming a historical record would be a lie.
   */
  completedLimit?: number;
  /**
   * Which mark set the rows draw. `details` is dsh's details card — an icon per
   * row plus the status word beside it; `stateDot` is dsh's panel language, a
   * core in a layout slot and a ring while running.
   */
  marks?: "details" | "stateDot";
  className?: string;
}) {
  const t = useT();
  const { rows, hiddenCompleted } =
    completedLimit === undefined
      ? { rows: [...todos], hiddenCompleted: 0 }
      : limitCompleted(todos, completedLimit);
  if (rows.length === 0) return null;

  return (
    <ul className={clsx(styles.list, className)} data-marks={marks}>
      {rows.map((item) => (
        // The content is the identity: the tool rejects a duplicate, and a
        // whole-list write carries no id to key on instead.
        <li key={item.content} className={styles.item} data-status={item.status}>
          {/* dsh labels the mark rather than hiding it: the shape carries the
              status on its own, and on the panel it is the only place it shows. */}
          <span className={styles.glyph} role="img" aria-label={todoStatusLabel(item.status, t)}>
            {marks === "stateDot" ? <StateDotMark status={item.status} /> : <DetailMark status={item.status} />}
          </span>
          <span className={styles.content}>{item.content}</span>
          {/* The details card names the status too, at the far end of the row. */}
          {marks === "details" ? (
            <span className={styles.statusText}>{todoStatusLabel(item.status, t)}</span>
          ) : null}
        </li>
      ))}
      {hiddenCompleted > 0 ? (
        <li className={styles.more}>{t("todo.hiddenCompleted", { count: hiddenCompleted })}</li>
      ) : null}
    </ul>
  );
}
