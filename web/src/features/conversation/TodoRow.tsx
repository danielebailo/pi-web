import { useMemo } from "react";
import { Glyph } from "../../components/dsh-icons.tsx";
import { StateDot } from "../../components/StateDot.tsx";
import type { ToolCallBlock } from "../../lib/types.ts";
import { DisclosureRow } from "./DisclosureRow.tsx";
import { useDisclosureOpen } from "./use-disclosure-open.ts";
import { TodoList, DetailMark } from "./TodoList.tsx";
import {
  parseTodoSnapshot,
  rowSummary,
  summarizeTodos,
  todosInArgs,
  type TodoItem,
} from "./todo-model.ts";
import { todoDiffModel, todoStatusLabel, type TodoDiff, type TodoDiffItem } from "./todo-diff-model.ts";
import { useTodoBaseline } from "./todo-history.tsx";
import type { ToolExecution } from "./useConversation.ts";
import styles from "./TodoRow.module.css";
import { useT } from "../../lib/app-state.ts";

/**
 * One `todo` call as a disclosure row.
 *
 * dsh's row has the same shape — checklist glyph, fixed title, and a
 * `done/total` summary naming whatever is in progress — because the tool behind
 * it writes a whole list too. The one thing that differs is where the list comes
 * from while the call is in flight: this tool carries it in the arguments, so a
 * running or rejected row still gets a real summary instead of the generic tool
 * one.
 *
 * Expanded it shows what the call changed rather than just the snapshot it left
 * behind — dsh's details: a caption naming the baseline, a per-row change mark
 * for added and removed rows, the old status for rows whose status moved, and
 * the untouched rows folded away. The very first write of a session shows its
 * list plainly; there is nothing to compare it against yet.
 */
export function TodoRow({
  call,
  execution,
  defaultOpen = false,
}: {
  call: ToolCallBlock;
  execution: ToolExecution | undefined;
  /** Whether the plan panel starts open — the verbose display opens every row. */
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useDisclosureOpen(defaultOpen);
  const state = execution?.isError ? "error" : execution?.running ? "running" : "ok";
  const running = execution?.running ?? false;
  const baseline = useTodoBaseline(call.id);

  const args = call.arguments ?? execution?.args;
  // The result is authoritative; the arguments are the fallback, and the only
  // source for a call that is still running or that failed outright.
  const todos = parseTodoSnapshot(execution?.details) ?? todosInArgs(args);
  const summary = todos === null ? null : summarizeTodos(todos);
  const extra = summary?.activeExtra ?? 0;
  const diff = useMemo(
    () => (todos === null ? null : todoDiffModel(todos, baseline, t)),
    [todos, baseline, t],
  );

  const body =
    todos === null
      ? running
        ? t("common.runningEllipsis")
        : t("todo.noSnapshot")
      : todos.length === 0 && (diff === null || diff.items.length === 0)
        ? t("todo.empty")
        : null;

  return (
    <div className={styles.root} data-tool={call.name} data-state={state}>
      {running ? <span className={styles.visuallyHidden}>{t("common.running")}</span> : null}

      <DisclosureRow
        rowClassName={styles.row}
        leadingClassName={styles.leading}
        titleClassName={styles.title}
        // A rejected call keeps its own glyph convention: the error dot.
        icon={state === "error" ? <StateDot state="error" /> : <Glyph name="checklist" />}
        title={t("todo.rowTitle")}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => setOpen((value) => !value)}
        collapsedContent={
          <>
            <span className={styles.sep} aria-hidden />
            <span className={styles.summary} data-error={execution?.isError || undefined}>
              {summary === null ? t(running ? "common.runningEllipsis" : "todo.noSnapshot") : rowSummary(summary, t)}
            </span>
            {diff !== null && summary !== null ? (
              <span className={styles.diffSummary}>{diff.summary}</span>
            ) : null}
            {extra > 0 ? <span className={styles.extra}>{`+${String(extra)}`}</span> : null}
          </>
        }
      >
        <div className={styles.card}>
          {body === null && todos !== null ? (
            diff === null ? (
              <TodoList todos={todos} />
            ) : (
              <TodoDiffList diff={diff} todos={todos} />
            )
          ) : (
            <span className={styles.empty}>
              {body ?? t(running ? "common.runningEllipsis" : "todo.noSnapshot")}
            </span>
          )}
        </div>
      </DisclosureRow>
    </div>
  );
}

/**
 * The expanded diff card: caption, changed rows with their marks, then the
 * untouched ones folded away. Rows are dsh's detail rows: a `+` or `−` for a row
 * that appeared or went away, a check or play icon for one that stayed, a hollow
 * square for one that has not started — and the status spelled out at the far
 * end, which is where dsh names it rather than in the mark.
 */
function TodoDiffList({ diff, todos }: { diff: TodoDiff; todos: readonly TodoItem[] }) {
  const t = useT();
  return (
    <div className={styles.diff}>
      <div className={styles.diffCaption}>{diff.caption}</div>
      <ul className={styles.diffList}>
        {diff.items.map((item) => (
          <DiffRow key={item.content} item={item} />
        ))}
      </ul>
      {diff.unchanged.length > 0 ? (
        <details className={styles.unchanged}>
          <summary>{t("todo.diff.unchanged", { count: diff.unchanged.length })}</summary>
          <TodoList todos={diff.unchanged} />
        </details>
      ) : null}
      {todos.length === 0 ? <span className={styles.empty}>{t("todo.empty")}</span> : null}
    </div>
  );
}

function DiffRow({ item }: { item: TodoDiffItem }) {
  const t = useT();
  const statusLabel = todoStatusLabel(item.status, t);
  return (
    <li
      className={styles.diffItem}
      data-status={item.status}
      data-change={item.change ?? undefined}
    >
      {/* dsh labels the mark with the change when there is one, the status
          otherwise — both already words in this project's model. */}
      <span className={styles.glyph} role="img" aria-label={item.changeLabel}>
        {item.change === "added" || item.change === "removed" ? (
          <span className={styles.diffMark}>{item.change === "added" ? "+" : "−"}</span>
        ) : (
          <DetailMark status={item.status} />
        )}
      </span>
      <span className={styles.content}>{item.content}</span>
      <span className={styles.statusChange}>
        {item.previousStatusLabel !== undefined ? `${item.previousStatusLabel} → ` : null}
        {statusLabel}
        {/* A row that only moved keeps its status word, with the move appended. */}
        {item.change === "moved" ? ` · ${item.changeLabel}` : null}
      </span>
    </li>
  );
}
