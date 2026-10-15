/**
 * The baseline each `todo` call diffs against — dsh's `todo-history.ts` shape,
 * without the event log. Here the transcript is the history: a forward scan
 * pairs every `todo` call with the newest snapshot that preceded it, and the
 * map rides down to the rows through a context so the turn components between
 * `MessageList` and `TodoRow` do not have to carry it.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentMessage } from "../../lib/types.ts";
import type { TodoItem } from "./todo-model.ts";
import { todoBaselinesOf } from "./todo-diff-model.ts";

const EMPTY: ReadonlyMap<string, readonly TodoItem[] | undefined> = new Map();

const TodoBaselinesContext = createContext<ReadonlyMap<string, readonly TodoItem[] | undefined>>(EMPTY);

export function TodoBaselinesProvider({ messages, children }: { messages: readonly AgentMessage[]; children: ReactNode }) {
  // `messages` is a fresh array on every publish, so the scan reruns then —
  // one pass per render over what the list already shows.
  const baselines = useMemo(() => todoBaselinesOf(messages), [messages]);
  return <TodoBaselinesContext.Provider value={baselines}>{children}</TodoBaselinesContext.Provider>;
}

/** The list this call replaced, or undefined when it is the first recorded write. */
export function useTodoBaseline(callId: string): readonly TodoItem[] | undefined {
  return useContext(TodoBaselinesContext).get(callId);
}
