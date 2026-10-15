/**
 * A real pass over plan mode, against a running pi.
 *
 * It drives an actual pi process — loading this repository's
 * `extensions/plan-mode.ts` the way the web server does, with an explicit
 * `--extension` — and asserts on what pi recorded and what came back on the
 * wire. The green half needs no model calls at all; the exit half spends a few
 * on a deliberately tiny prompt.
 *
 * Usage:
 *   pnpm test:plan-mode          # log: the command and the state it writes
 *   pnpm test:plan-mode exit     # the review card and the approval (model calls)
 *   pnpm test:plan-mode all
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir, RpcClient } from "@earendil-works/pi-coding-agent";
import { decodeAskUserBatch } from "../ask-user-codec.ts";

const ROOT = "/tmp/piws-plan-mode-e2e";
const CLI = join(getPackageDir(), "dist/cli.js");
/** `server/src/testing/` → the checkout root, where `extensions/` lives. */
const EXT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..", "extensions");

/**
 * The `customType` the extension writes, duplicated on purpose: the extension
 * runs inside the pi process and cannot import server code. The server-side
 * reading of the same entry — and its folding — is pinned without a process in
 * `server/src/session-plan.test.ts`.
 */
const PLAN_MODE_ENTRY = "pi-web-simple:plan-mode";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && detail.length > 0 ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Poll until `predicate` holds. */
async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return predicate();
}

/** One entry as `get_entries` reports it, narrowed to the fields these checks read. */
interface Entry {
  type?: string;
  customType?: string;
  data?: unknown;
  message?: { role?: string };
}

/** One `select` frame pi sent, kept so the review can be decoded and answered. */
interface UiFrame {
  id: string;
  title: string;
}

/** The plan-mode entries in one log, in append order. */
function planEntries(entries: readonly Entry[]): Entry[] {
  return entries.filter((entry) => entry.type === "custom" && entry.customType === PLAN_MODE_ENTRY);
}

/** Whether one entry's payload says plan mode is on. */
function isActive(entry: Entry | undefined): boolean {
  return (entry?.data as { active?: unknown } | undefined)?.active === true;
}

/** Answer the dialog the way the web client does: a serialized decision. */
function answer(client: RpcClient, id: string, value: unknown): void {
  const stdin = (client as unknown as { process: { stdin: { write(text: string): void } } }).process.stdin;
  stdin.write(`${JSON.stringify({ type: "extension_ui_response", id, ...(value as object) })}\n`);
}

/**
 * One fresh pi process, in a fresh session directory.
 *
 * `extensions` are named explicitly, in the order the server loads them: the
 * exit scenario needs the question tool, and a session without it would fall
 * back to a native dialog that this client cannot answer the same way.
 */
async function withPi(
  run: (client: RpcClient, frames: UiFrame[]) => Promise<void>,
  extensions: readonly string[] = ["plan-mode.ts"],
): Promise<void> {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  const client = new RpcClient({
    cliPath: CLI,
    cwd: ROOT,
    args: [
      ...extensions.flatMap((name) => ["--extension", join(EXT_ROOT, name)]),
      "--approve",
      "--session-dir",
      join(ROOT, "sessions"),
    ],
  });
  const frames: UiFrame[] = [];
  client.onEvent((event: { type?: string; method?: unknown; id?: unknown; title?: unknown }) => {
    if (
      event.type === "extension_ui_request"
      && event.method === "select"
      && typeof event.title === "string"
    ) {
      frames.push({ id: String(event.id), title: event.title });
    }
  });
  try {
    await client.start();
    await run(client, frames);
  } finally {
    await client.stop();
  }
}

/**
 * The command and its log entry — no model calls.
 *
 * pi consumes an extension command without starting a run, which is also why
 * nothing here ever reaches disk: pi opens the session file lazily, on the first
 * real message, so a session that has only seen `/plan` lives in the process
 * alone.
 */
async function logScenario(): Promise<void> {
  console.log("\n== plan mode is one log entry, and the newest one is the state ==");
  await withPi(async (client) => {
    const commands = await client.getCommands();
    const planCommand = commands.find(
      (command) => command.name === "plan" && command.source === "extension",
    );
    check(
      "the deployment's /plan command is registered",
      planCommand !== undefined,
      planCommand === undefined ? commands.map((command) => command.name).join(", ") : "",
    );
    check("the log starts with no plan entry", planEntries((await client.getEntries()).entries).length === 0);

    const entered = await client.prompt("/plan");
    check("pi handled the command instead of starting a run", entered === "handled", String(entered));

    const afterEnter = (await client.getEntries()).entries as Entry[];
    const first = planEntries(afterEnter);
    check("one entry, saying active", first.length === 1 && isActive(first[0]), JSON.stringify(first[0]?.data));
    check(
      "the command wrote no user message of its own",
      afterEnter.every((entry) => entry.type !== "message" || entry.message?.role !== "user"),
    );

    await client.prompt("/plan");
    check(
      "repeating it is a no-op, not a second entry",
      planEntries((await client.getEntries()).entries).length === 1,
    );

    await client.prompt("/plan off");
    const off = planEntries((await client.getEntries()).entries).at(-1);
    check("the newest entry says inactive", off !== undefined && !isActive(off), JSON.stringify(off?.data));

    await client.prompt("/plan");
    const back = planEntries((await client.getEntries()).entries).at(-1);
    check("and back on again, as a third entry", isActive(back), JSON.stringify(back?.data));
  });

  console.log("\n== leaving a mode that was never entered writes nothing ==");
  await withPi(async (client) => {
    const left = await client.prompt("/plan off");
    check("the command is still handled", left === "handled", String(left));
    check(
      "no entry was appended for a state that already held",
      planEntries((await client.getEntries()).entries).length === 0,
    );
  });
}

/**
 * The reviewed exit — the one path a model has to walk, and therefore the one
 * scenario that costs model calls.
 */
async function exitScenario(): Promise<void> {
  console.log("\n== exit_plan_mode: the review card, and what an approval logs ==");
  await withPi(async (client, frames) => {
    check("the /plan command runs", (await client.prompt("/plan")) === "handled");

    await client.prompt(
      "Call the exit_plan_mode tool exactly once with plan = \"# 冒烟测试计划\\n\\n1. 只做一件事。\" "
        + "Do not call any other tool. Then reply with one word.",
    );
    check("a review frame arrives", await waitFor(() => frames.length > 0, 180_000));

    const batch = decodeAskUserBatch(frames[0]?.title);
    const question = batch?.questions[0];
    check("it carries the plan-review intent", question?.intent?.kind === "plan-review");
    check("the approve label is this extension's own", question?.intent?.approve === "Approve");
    // The call that submitted the plan travels with the intent, which is how the
    // client reopens the logged document after the review closes.
    check(
      "the intent names the tool call that submitted it",
      typeof question?.intent?.callId === "string" && question.intent.callId.length > 0,
      String(question?.intent?.callId),
    );
    check("the card title is the plan's heading", batch?.title === "冒烟测试计划", String(batch?.title));
    check("the plan itself is carried", (question?.detail ?? "").startsWith("# 冒烟测试计划"));
    // A review someone is still reading must not expire into "nobody answered".
    check("no deadline is invented for a plan review", batch?.timeoutMs === undefined, String(batch?.timeoutMs));

    answer(client, frames[0]!.id, {
      value: JSON.stringify({ answers: [{ id: "plan-review", selected: ["Approve"] }] }),
    });
    await client.waitForIdle(180_000);

    const last = planEntries((await client.getEntries()).entries).at(-1);
    check(
      "approving logged the exit",
      last !== undefined && !isActive(last),
      JSON.stringify(last?.data),
    );
  }, ["plan-mode.ts", "ask-user.ts"]);
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  log: logScenario,
  exit: exitScenario,
};

const requested = process.argv[2] ?? "log";
const names = requested === "all" ? Object.keys(SCENARIOS) : [requested];

for (const name of names) {
  const scenario = SCENARIOS[name];
  if (scenario === undefined) {
    console.error(`unknown scenario ${JSON.stringify(name)} — expected ${Object.keys(SCENARIOS).join(", ")} or all`);
    process.exit(2);
  }
  await scenario();
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
