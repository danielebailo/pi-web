#!/usr/bin/env node
/**
 * Regenerate the README screenshots.
 *
 * Chrome's `--screenshot` flag hangs on some macOS builds (it never returns;
 * `--dump-dom` works fine), so this drives the DevTools protocol instead:
 * connect to a headless Chrome that was started with
 * `--remote-debugging-port`, walk to the state the scene describes, and capture
 * at 2x.
 *
 * ## What it expects
 *
 * A throwaway demo project outside the repository, whose session was produced
 * by a real `pi` run, and a pi-web-simple serving it. Concretely:
 *
 * ```sh
 * # 1. a tiny project, and a session that actually edits it
 * mkdir -p /tmp/pws-demo/zh-project && cd /tmp/pws-demo/zh-project
 * git init && printf 'export const greet = () => "hello";\n' > greet.js && git add -A && git commit -m init
 * PI_CODING_AGENT_SESSION_DIR=/tmp/pws-demo/sessions \
 *   pi -p --approve "把 greet.js 的问候语改成你好，pi，并在 README 里记一笔，最后跑一次确认"
 *
 * # 2. pi writes the session under its realpath (`/private/tmp/...` on macOS),
 * #    so the project path in the store must be the realpath too.
 * mv /tmp/pws-demo/sessions/--*-zh-project-- /tmp/pws-demo/sessions/--private-tmp-pws-demo-zh-project--
 *
 * # 3. serve it, with an isolated store pointing at that project
 * PI_WEB_SIMPLE_HOME=/tmp/pws-demo/home-zh PI_WEB_SIMPLE_SESSION_DIR=/tmp/pws-demo/sessions \
 *   PI_WEB_SIMPLE_PORT=5477 PI_WEB_SIMPLE_OPEN=0 node server/build/index.js &
 *
 * # 4. a headless Chrome to drive, then this script
 * "$CHROME" --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/chrome \
 *   --no-first-run --disable-gpu --window-size=1600,1150 about:blank &
 * node scripts/screenshots.mjs --scene overview --lang zh-CN --appearance dark --out docs/images/overview-dark.png
 * ```
 *
 * Repeat step 3 with a second project/session (and `--lang en`) for the
 * English set: `*-dark.en.png`.
 *
 * ## Scenes
 *
 * `overview` captures the whole viewport — the conversation with the change set
 * on the right, which is the README's lead image. The other three are feature
 * shots, and they crop to the composer instead: at README width a full window
 * leaves the subject occupying a fifteenth of the frame, which is not readable.
 * The crop is computed from the live layout, so it follows the app rather than
 * a hard-coded rectangle.
 *
 *   overview   conversation + change set, full window
 *   preset     the agent-preset chip on the new-session page, menu open
 *   mention    the `@` file-mention menu in the composer
 *   modelcard  the model + thinking-level card, open
 *
 * Options:
 *   --app <url>         pi-web-simple base URL (default http://127.0.0.1:5477)
 *   --cdp <url>         Chrome DevTools endpoint (default http://127.0.0.1:9222)
 *   --scene <name>      one of the scenes above (default overview)
 *   --lang <tag>        zh-CN | en — pushed through the settings API
 *   --appearance <mode> dark | light
 *   --project <path>    project path to expand; defaults to one under /tmp
 *   --session <hint>    substring of the session file path to click
 *   --insert <text>     insert this after the scene runs, before the shot
 *   --out <file>        PNG to write
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const app = arg("app", "http://127.0.0.1:5477");
const cdp = arg("cdp", "http://127.0.0.1:9222");
const scene = arg("scene", "overview");
const lang = arg("lang", "zh-CN");
const appearance = arg("appearance", "dark");
const projectHint = arg("project", "/private/tmp/pws-demo");
const sessionHint = arg("session", "2026-");
const insert = arg("insert");
const out = arg("out");
if (out === undefined) {
  console.error("--out <file> is required");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal CDP client: one page target, `send(method, params)` per call. */
async function connect() {
  const targets = await (await fetch(`${cdp}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (page === undefined) throw new Error(`no page target at ${cdp}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve !== undefined) {
      pending.delete(message.id);
      resolve(message);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return res.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

/**
 * Helpers injected into every scene.
 */
const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byTitle = (needle) => [...document.querySelectorAll('[title]')].find((el) => (el.getAttribute('title') ?? '').includes(needle));
  const byText = (needles) => [...document.querySelectorAll('button')].find((b) => needles.includes((b.textContent ?? '').trim()));
  const done = [];
`;

/**
 * The crop, run *after* the scene settles.
 *
 * It is the union of the input card and everything open around it — the preset
 * menu, the `@` candidates, the model card, and on the hero the heading above
 * them — rather than a rectangle kept in sync by hand. Measuring late is
 * load-bearing for the `@` scene: the candidates appear only once the text is
 * inserted, which happens after the scene's own steps.
 */
const CLIP_FN = `
  const subjectClip = () => {
    const parts = [];
    // The real input, not a draft mirror: only the editable one is labeled.
    const ta = document.querySelector('textarea[aria-label]') ?? document.querySelector('textarea');
    if (ta) {
      // Its card: the nearest ancestor that holds more than one button.
      let card = ta;
      for (let el = ta; el && el.parentElement; el = el.parentElement) {
        if (el.querySelectorAll('button').length >= 2) { card = el; break; }
      }
      parts.push(card);
    }
    // Everything that opened above it, plus the hero's own heading.
    for (const sel of ['[role="listbox"]', '[role="dialog"]', 'h1']) {
      for (const el of document.querySelectorAll(sel)) parts.push(el);
    }
    const boxes = parts
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    if (boxes.length === 0) return null;
    const left = Math.min(...boxes.map((r) => r.left));
    const right = Math.max(...boxes.map((r) => r.right));
    const top = Math.min(...boxes.map((r) => r.top));
    const bottom = Math.max(...boxes.map((r) => r.bottom));
    const pad = 28;
    return {
      x: Math.max(0, left - pad),
      y: Math.max(0, top - pad),
      width: right - left + pad * 2,
      height: bottom - top + pad * 2,
    };
  };
`;

/** Opening a session, shared by the scenes that need one. */
const OPEN_SESSION = `
  const project = byTitle(${JSON.stringify(projectHint)});
  if (project) { project.click(); done.push('project'); await sleep(900); }
  const row = byTitle(${JSON.stringify(sessionHint)});
  row?.querySelector('button')?.click();
  if (row) { done.push('session'); await sleep(3400); }
`;

const SCENES = {
  // The conversation + the change set on the right — the README's lead image.
  // Full viewport: this one is meant to be read as the whole product.
  overview: {
    crop: false,
    steps: `
      ${OPEN_SESSION}
      const rightbarButton = byTitle('打开右侧栏') ?? byTitle('Open the sidebar');
      if (rightbarButton) { rightbarButton.click(); done.push('rightbar'); await sleep(1000); }

      const newTab = byTitle('新建标签页') ?? byTitle('New tab');

      // The change set is normally the tab the sidebar restores, so this only
      // makes sure it is the one on top. A fresh profile restores the file tree
      // instead, in which case the tab comes from the "+" menu — which is closed
      // again with Escape, because that portal only listens for real pointer
      // events and a synthetic click would leave it open on top of the panel.
      const changesTab = byText(['文件变更', 'Changes']);
      if (changesTab) {
        changesTab.click(); done.push('changes'); await sleep(2000);
      } else if (newTab) {
        newTab.click(); await sleep(600);
        const changesItem = byText(['文件变更', 'Changes']);
        if (changesItem) { changesItem.click(); done.push('changes-new'); await sleep(2000); }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(700);
      }

      // Scroll the transcript back to the top so the shot starts at the first
      // user message. The transcript is a sibling of the composer, not an
      // ancestor, so this climbs the composer's ancestors and takes the tallest
      // overflowing container inside the first one that has any. CSS-module
      // hashes change with every style edit, so nothing here matches on a class
      // name.
      let scroller = null;
      for (let el = document.querySelector('textarea'); el && !scroller; el = el.parentElement) {
        const overflowing = [...el.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 20);
        if (overflowing.length > 0) scroller = overflowing.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
      }
      if (scroller) { scroller.scrollTop = 0; done.push('scrollTop'); await sleep(900); }
    `,
  },

  // The agent-preset chip on the new-session page, with its menu open. dsh's
  // minimal preset is what the menu's second row selects.
  preset: {
    crop: true,
    steps: `
      const project = byTitle(${JSON.stringify(projectHint)});
      if (project) { project.click(); done.push('project'); await sleep(900); }
      const newSession = byTitle('新建会话') ?? byTitle('New session');
      if (newSession) { newSession.click(); done.push('hero'); await sleep(1600); }
      // The preset chip is the listbox button that carries an aria-label; the
      // workspace chip beside it has none.
      const chip = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find((b) => b.getAttribute('aria-label') !== null);
      if (chip) { chip.click(); done.push('menu'); await sleep(1000); }
    `,
  },

  // The `@` file-mention menu, opened with --insert "@".
  mention: {
    crop: true,
    steps: `
      ${OPEN_SESSION}
      const ta = document.querySelector('textarea');
      if (ta) { ta.focus(); done.push('focus'); }
    `,
  },

  // The model + thinking-level card. The model and context chips are the
  // composer's only two dialog buttons, and the model one comes first.
  modelcard: {
    crop: true,
    steps: `
      ${OPEN_SESSION}
      const model = document.querySelectorAll('button[aria-haspopup="dialog"]')[0];
      if (model) { model.click(); done.push('card'); await sleep(2600); }
    `,
  },
};

const chosen = SCENES[scene];
if (chosen === undefined) {
  console.error(`unknown scene: ${scene} (have: ${Object.keys(SCENES).join(", ")})`);
  process.exit(1);
}

const { send, evaluate, close } = await connect();

await fetch(`${app}/api/settings`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ language: lang, appearance }),
});

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 1150,
  deviceScaleFactor: 2,
  mobile: false,
});
await send("Page.navigate", { url: `${app}/` });
await sleep(4000);

const result = await evaluate(`(async () => {${HELPERS}${chosen.steps}
  return { steps: done.join(',') };
})()`);

/**
 * Optional text for the scene that needs it.
 *
 * `Input.insertText` goes through the browser's own editing pipeline, so React
 * sees a real `input` event; writing `textarea.value` would update the DOM and
 * leave the completion menu closed.
 */
if (insert !== undefined) {
  await evaluate(`document.querySelector('textarea')?.focus(), null`);
  await sleep(400);
  await send("Input.insertText", { text: insert });
  await sleep(1600);
}

// Measured now, not inside the scene: the `@` scene's candidates only exist
// after the text above landed.
const box = chosen.crop ? await evaluate(`(() => {${CLIP_FN} return subjectClip(); })()`) : null;

console.log(`${out} ← ${scene} [${result?.steps ?? ""}]${box ? ` crop ${Math.round(box.width)}×${Math.round(box.height)}` : ""}`);

await sleep(1200);
/**
 * The crop, in CSS pixels.
 *
 * `scale` is not optional: omitting it makes Chrome answer `-32602 Invalid
 * parameters` rather than defaulting to 1. It also multiplies the device-metrics
 * factor rather than replacing it (measured: 720×1280 CSS at scale 2 with
 * `deviceScaleFactor: 2` comes back 3200px wide), so 1 is what keeps these at the
 * same 2× as the unclipped shots.
 */
const clip =
  box === null
    ? undefined
    : {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        scale: 1,
      };
const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false,
  ...(clip === undefined ? {} : { clip }),
});
if (shot.result?.data === undefined) throw new Error("captureScreenshot returned no data");
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
close();
