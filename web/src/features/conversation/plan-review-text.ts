/**
 * The two pieces of a submitted plan a card can show without a renderer.
 *
 * dsh reads the same two out of `extractMarkdownPlainText` — a title from the
 * plan's first line and a summary from its first paragraph — and it is what
 * keeps the review card honest: the plan is arbitrary markdown, and a preview
 * that opened with `#` or `-` would read as a fragment instead of a sentence.
 *
 * The title and the paragraph are read from the document itself rather than
 * from what the asker typed into `header`/`question`, because a plan-mode
 * extension hands the whole plan over as `detail` and may describe the request
 * in its own words (`Plan review`, `Approve this plan and leave plan mode?`)
 * rather than repeat the plan's heading.
 */

/** One line as plain prose: links keep their text, decorations go. */
function plain(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`_]/g, "")
    .replace(/^[#>\-*\s]+/, "")
    .trim();
}

/** Whether one block is a heading line rather than prose. */
function heading(block: string): boolean {
  return /^\s{0,3}#{1,6}\s/.test(block);
}

/** The plan's title: its first heading or line, without the markdown. */
export function planTitleOf(plan: string): string {
  for (const line of plan.split("\n")) {
    const text = plain(line);
    if (text.length > 0) return text;
  }
  return "";
}

/**
 * The plan's first paragraph, or "" when there is nothing but a title.
 *
 * A heading block is skipped rather than quoted: the title is already above
 * this line on the card, and repeating it as the summary is the same sentence
 * twice.
 */
export function planDescription(plan: string): string {
  for (const block of plan.split(/\n{2,}/)) {
    if (heading(block)) continue;
    const text = block.split("\n").map(plain).filter((line) => line.length > 0).join(" ");
    if (text.length > 0) return text;
  }
  return "";
}
