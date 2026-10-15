/**
 * Plan mode — explore and design first, execute only after the user approves.
 *
 * This is dsh's plan mode (`@deepseek-ai/dsh-plan-mode`), rebuilt on pi's
 * extension seams. While plan mode is active, one prompt section tells the model
 * to investigate before it acts, and `exit_plan_mode` hands the finished plan to
 * the user as a review decision. `/plan` enters it, `/plan off` leaves it, and
 * `/plan <message>` enters it and submits that message as the next request.
 *
 * Plan mode guides rather than restricts — every tool stays available, exactly
 * like dsh's "soft guidance" rule. A deployment that wants enforced limits
 * configures those separately; this file only changes what the model is told.
 *
 * **State lives in the session log, not in this process.** `pi.appendEntry()`
 * writes one `custom` entry per transition, and every read folds the current
 * branch from the newest one — so resume, fork and compaction recover the state
 * for free, and no byte of it lives in a closure. This is the same replay rule
 * `todo.ts` uses for its list, and the pi-side cousin of dsh's log-only
 * `plan/mode` event.
 *
 * **The exit tool stays registered while plan mode is inactive**, again like
 * dsh: entering or leaving changes the prompt section, never the request's tool
 * catalog, so a mode switch cannot invalidate the provider's tool cache.
 *
 * The review rides on `ask_user_question` when that tool is present (the Web
 * deployment always loads it), which is how the plan lands on the same
 * approval card any other `plan-review` intent uses. A terminal session without
 * it falls back to one native `select`.
 *
 * Web-only, like `ask-user.ts` and `todo.ts`: this file is absent from the
 * package's `pi.extensions` manifest, which lists only `/web`, and
 * `server/src/presets.ts` hands it to the RPC processes this deployment spawns.
 * The TUI branches below serve a session that loaded it by hand with
 * `pi -e extensions/plan-mode.ts`.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

/**
 * The `customType` of the one entry this file writes.
 *
 * Namespaced, like pi's own `pi.virtual-model-state`: the log is shared with
 * every other extension in the process, and a bare `plan-mode` would invite a
 * collision. `data` is always `{ active: boolean }` — a whole-value replace,
 * never a delta.
 */
const ENTRY_TYPE = "pi-web-simple:plan-mode";

/**
 * The system-prompt section the guidance renders as, while plan mode is active.
 *
 * pi wraps extra sections in a tag of the same name, and the tag is what lets a
 * transcript patch say exactly which section changed — so it is lowercase and
 * dash-separated rather than dsh's `plan:policy`.
 */
const POLICY_SECTION = "plan-mode";

/**
 * The guidance the model reads while planning.
 *
 * It is the whole policy, and it is deliberately a *soft* one: dsh restrains
 * through text and leaves enforcement to sandbox and approval settings, so the
 * wording asks for investigation and a presented plan, not for a tool filter.
 * Written as commands so it reads as an instruction rather than a description of
 * a mode the model has never heard of.
 */
const PLAN_GUIDANCE = [
	"You are in plan mode. Explore and design before you execute.",
	"Investigate first: read the files and gather the evidence the design needs, and settle the open questions there rather than guessing.",
	"Do not change anything yet. Read-only work is what this mode is for; wait until the user approves the plan before you edit, write, or run commands that make the change.",
	"When the design is complete, call exit_plan_mode with the whole plan as markdown that starts with a `#` heading naming it. Write the plan in the user's language and make it concrete enough to execute.",
	"If the user asks you to keep planning, revise the plan and present it again through exit_plan_mode.",
].join(" ");

/** The exit tool's name. Fixed by dsh's vocabulary and by the prompt above. */
const EXIT_PLAN_MODE = "exit_plan_mode";

/** The review question's id, echoed back in the answer this file reads. */
const REVIEW_ID = "plan-review";

/** The review question's approve option label. */
const APPROVE_LABEL = "Approve";

/** The review question's keep-planning option label. */
const KEEP_PLANNING_LABEL = "Keep planning";

const EXIT_DESCRIPTION =
	"Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. "
	+ "The user may approve (carry out the plan from your next step) or keep planning — their feedback comes "
	+ "back in the tool result; revise and present the plan again.";

/** What one review turned into. */
interface ReviewOutcome {
	approved: boolean;
	/** What the user wrote when they chose to keep planning. */
	feedback: string;
}

/** Shape of one `ask_user_question` answer item, as this file reads it. */
interface ReviewAnswer {
	id?: unknown;
	selected?: unknown;
	custom?: unknown;
}

/** Shape of the details `ask_user_question` returns. */
interface AskUserDetails {
	answers?: unknown;
	outcome?: unknown;
}

/** The plan's title: its first markdown heading, or a fallback. */
function planTitle(plan: string): string {
	for (const line of plan.split("\n")) {
		const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (match) return match[1]!;
	}
	return "Plan review";
}

/**
 * Whether the branch's newest `plan-mode` entry says plan mode is active.
 *
 * Missing entries fold to inactive, which is what makes a session that never
 * saw this file (or one whose branch was truncated) start out of plan mode
 * rather than in an unaccounted-for state.
 */
function readPlanActive(ctx: ExtensionContext): boolean {
	let active = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = entry.data as { active?: unknown } | undefined;
		if (typeof data?.active === "boolean") active = data.active;
	}
	return active;
}

/** Append one whole-value transition. */
function writePlanActive(pi: ExtensionAPI, active: boolean): void {
	pi.appendEntry(ENTRY_TYPE, { active });
}

/**
 * The review question, as a batch of one.
 *
 * The approve label is this file's own constant, and the card renders whatever
 * string it is handed verbatim — so the wire value the user sees, the option the
 * extension validates against, and the label the answer echoes are the same
 * three bytes by construction.
 */
function reviewQuestions(plan: string, callId: string | undefined): unknown[] {
	return [{
		id: REVIEW_ID,
		header: planTitle(plan),
		question: "Approve this plan and leave plan mode?",
		detail: plan,
		options: [
			{ label: APPROVE_LABEL, description: "Leave plan mode; carry out the plan from the next step." },
			{ label: KEEP_PLANNING_LABEL, description: "Stay in plan mode; feedback goes back to the model." },
		],
		// `callId` is the calling tool invocation, and it travels with the intent so
		// the client can reopen the logged plan afterwards — the same field dsh's
		// plan review carries, for the same reason.
		intent: {
			kind: "plan-review",
			approve: APPROVE_LABEL,
			...(callId === undefined ? {} : { callId }),
		},
	}];
}

/** Read one answer item, tolerating the shapes a client may have sent. */
function readAnswer(details: AskUserDetails): ReviewAnswer | null {
	if (!Array.isArray(details.answers)) return null;
	for (const value of details.answers) {
		if (typeof value !== "object" || value === null) continue;
		const item = value as ReviewAnswer;
		if (item.id === REVIEW_ID) return item;
	}
	return null;
}

/** Turn one answer item into the decision it encodes. */
function outcomeFrom(answer: ReviewAnswer): ReviewOutcome {
	const selected = Array.isArray(answer.selected)
		? answer.selected.filter((label): label is string => typeof label === "string")
		: [];
	const custom = typeof answer.custom === "string" ? answer.custom : "";
	const approved = selected.length === 1 && selected[0] === APPROVE_LABEL && custom === "";
	return { approved, feedback: approved ? "" : custom };
}

/**
 * Ask through `ask_user_question`, the Web deployment's review channel.
 *
 * The nested call gets its own tool-call id and never appears in the transcript,
 * so the plan the user reviewed lives only in this review request — which is
 * what dsh does too (the plan stays in the call log, not in a second message).
 * A failed nested call comes back as `isError` rather than throwing, and every
 * one of those is a failed review: the model has to see that no decision was
 * made instead of reading silence as approval.
 */
async function reviewOverAskUser(
	ctx: ExtensionToolContext,
	plan: string,
	callId: string | undefined,
	signal: AbortSignal | undefined,
): Promise<ReviewOutcome> {
	const outcome = await ctx.executeTool(
		"ask_user_question",
		// `timeout: -1` is the question tool's "wait indefinitely", and it has to be
		// said out loud: its own default is two minutes, and a plan someone is still
		// reading through must not expire into "nobody answered". dsh's review is an
		// open question too, for the same reason.
		{ questions: reviewQuestions(plan, callId), timeout: -1 },
		signal === undefined ? undefined : { signal },
	);
	if (outcome.isError) {
		const text = outcome.result.content?.[0];
		const reason = text?.type === "text" ? text.text : "the review could not be shown";
		throw new Error(`The plan review failed: ${reason}`);
	}
	const details = (outcome.result.details ?? {}) as AskUserDetails;
	if (details.outcome === "timed-out" || details.outcome === "cancelled") {
		throw new Error(
			details.outcome === "timed-out"
				? "The plan review expired before the user answered; stay in plan mode and present the plan again."
				: "The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.",
		);
	}
	const answer = readAnswer(details);
	if (answer === null) {
		throw new Error("The plan review returned no decision; stay in plan mode and present the plan again.");
	}
	return outcomeFrom(answer);
}

/**
 * Ask through one native dialog, for a session without the question tool.
 *
 * A terminal user gets the two labels directly; choosing to keep planning opens
 * one free-text prompt for the feedback, because that is the only way the model
 * can hear *what* to change.
 */
async function reviewOverNativeUi(
	ctx: ExtensionToolContext,
	plan: string,
	signal: AbortSignal | undefined,
): Promise<ReviewOutcome> {
	const title = `${planTitle(plan)}\n\n${plan}`;
	const picked = await ctx.ui.select(title, [APPROVE_LABEL, KEEP_PLANNING_LABEL], {
		...(signal === undefined ? {} : { signal }),
	});
	if (picked === undefined) {
		throw new Error("The user dismissed the plan review to speak instead; stay in plan mode, stop here, and wait for their message.");
	}
	if (picked === APPROVE_LABEL) return { approved: true, feedback: "" };
	const feedback = await ctx.ui.input("What should change in the plan?");
	return { approved: false, feedback: feedback?.trim() ?? "" };
}

/** Whether the deployment's question tool is callable from here. */
function hasAskUser(ctx: ExtensionToolContext): boolean {
	return ctx.tools.some((tool) => tool.name === "ask_user_question");
}

export default function planMode(pi: ExtensionAPI): void {
	/**
	 * While plan mode is active, add the guidance section to the request.
	 *
	 * `before_agent_start` is the one moment the system prompt is still mutable
	 * for this run, and the state is read fresh from the log every time — so a
	 * `/plan` typed mid-session takes effect on the very next request, and a
	 * resumed or forked session inherits it from its own branch.
	 */
	pi.on("before_agent_start", (event, ctx) => {
		if (!readPlanActive(ctx)) return;
		event.systemPromptOptions.sections[POLICY_SECTION] = PLAN_GUIDANCE;
	});

	/**
	 * `/plan` enters plan mode, `/plan off` leaves it, and `/plan <message>`
	 * enters it and sends that message as the next request.
	 *
	 * dsh submits the message through `agent.steer()`; pi's equivalent is
	 * `pi.sendUserMessage()`, which also starts the turn the guidance applies to.
	 * Sent as `steer` while the agent is streaming, because an extension command
	 * runs even then and a bare second turn would be refused.
	 */
	pi.registerCommand("plan", {
		description: "Enter plan mode (/plan), leave it (/plan off), or enter it with a request (/plan <message>)",
		getArgumentCompletions: (prefix) => {
			const items = ["off"].filter((item) => item.startsWith(prefix));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const message = args.trim();
			const active = readPlanActive(ctx);

			if (message === "off") {
				if (!active) {
					ctx.ui.notify("Plan mode is already inactive.", "info");
					return;
				}
				// The switch itself is not announced: the composer's plan chip is the
				// answer, it appears and leaves with the mode, and a notice would sit
				// on top of it (a notice here stays until dismissed). Only a command
				// that changes nothing speaks, because then nothing on screen moved.
				writePlanActive(pi, false);
				return;
			}

			if (!active) writePlanActive(pi, true);
			if (message === "") {
				if (active) ctx.ui.notify("Plan mode is already on.", "info");
				return;
			}
			// The message is the request plan mode applies to; the guidance section
			// is already logged, so the turn it starts reads it.
			pi.sendUserMessage(message, ctx.isIdle() ? undefined : { deliverAs: "steer" });
		},
	});

	/**
	 * The reviewed exit.
	 *
	 * Registered unconditionally, so the request's tool catalog never changes
	 * when the mode does. Outside plan mode it fails; inside, it validates the
	 * plan's shape before asking, so a malformed plan is fixed by the model
	 * rather than shown to the user as an approval card it cannot approve.
	 */
	pi.registerTool({
		name: EXIT_PLAN_MODE,
		label: "Exit Plan Mode",
		description: EXIT_DESCRIPTION,
		promptSnippet: "Present a finished plan for the user's approval and leave plan mode",
		parameters: Type.Object({
			plan: Type.String({
				description: "The complete plan, as markdown, starting with a # heading that names it.",
			}),
		}),
		executionMode: "sequential",

		async execute(toolCallId, params, signal, _onUpdate, ctx): Promise<{ content: { type: "text"; text: string }[]; details: { approved: true } }> {
			const plan = params.plan.trim();
			if (!readPlanActive(ctx)) {
				throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`);
			}
			if (!/^#\s+\S/.test(plan)) {
				throw new Error(`${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`);
			}
			const decision = hasAskUser(ctx)
				? await reviewOverAskUser(ctx, plan, toolCallId, signal)
				: ctx.hasUI
					? await reviewOverNativeUi(ctx, plan, signal)
					: (() => {
						throw new Error("No review channel is available; the user can leave plan mode with /plan off.");
					})();
			if (!decision.approved) {
				throw new Error(
					decision.feedback === ""
						? "The user chose to keep planning; revise the plan and present it again."
						: `The user chose to keep planning; their feedback: ${decision.feedback}`,
				);
			}
			// Leaving is logged, but the guidance stays in this turn's system prompt
			// — the request was already assembled — so the rest of the current tool
			// batch still runs under plan mode. That is dsh's silent pending exit,
			// reached here by the shape of pi's prompt assembly rather than a timer.
			writePlanActive(pi, false);
			return {
				content: [{
					type: "text",
					text: "Plan approved — plan mode exited; carry out the plan starting with your next step.",
				}],
				details: { approved: true },
			};
		},

		renderCall(args, theme) {
			const title = typeof args?.plan === "string" && args.plan.trim() !== "" ? planTitle(args.plan) : "plan";
			return new Text(theme.fg("toolTitle", theme.bold("exit_plan_mode ")) + theme.fg("muted", title), 0, 0);
		},

		renderResult(result, options: ToolRenderResultOptions, theme) {
			const details = result.details as { approved?: unknown } | undefined;
			if (details?.approved === true) {
				return new Text(`${theme.fg("success", "✓ ")}${theme.fg("text", "Plan approved — plan mode exited")}`, 0, 0);
			}
			const block = result.content[0];
			return new Text(block?.type === "text" ? block.text : "", 0, 0);
		},
	});
}
