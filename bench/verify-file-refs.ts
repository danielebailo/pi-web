/**
 * 文件引用的行为验证。
 *
 * 与 scenario-c/d 共用同一套设施（真实前端产物 + 真实 Chrome，经 CDP 驱动，
 * pi 进程完全不起——非驻留会话直接从磁盘读），但它断言的是**行为**而不是
 * 性能，所以不往 `results/` 写数字。它走的是完整链路：
 *
 *   Markdown（链接 + 行内代码）
 *     → `file-ref.ts` 解析 → `turn-refs.ts` 的词汇表判定 → chip
 *     → 点击 → `rightbarActions.openFileRef` → 右栏预览标签页
 *     → `CodeView` 滚到目标行并高亮
 *
 * 也就是单元测试覆盖不到的那一段：chip 与预览面板之间隔着 context、
 * store、路由与一次真实的文件读取。
 *
 * 用法（先构建前端）：
 *   pnpm --filter web build
 *   pnpm test:file-refs
 *
 * 环境变量：
 *   FILE_REFS_KEEP=1   保留临时目录与截图路径，便于事后翻看
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpConnection, findChromeTarget } from "./lib/cdp.mjs";
import { sanitizeProjectDirName } from "./lib/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const ROOT = join(HERE, ".bench-tmp", `file-refs-${process.pid}`);
const PROJECT_DIR = join(ROOT, "project");
const HOME_DIR = join(ROOT, "home");
const SESSION_ROOT = join(ROOT, "sessions");
const CHROME_PROFILE = join(ROOT, "chrome-profile");
const DIST_INDEX = join(REPO, "web", "dist", "index.html");
const LOAD_STUB = join(HERE, "load-stub.mjs");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.error(`[file-refs] ${message}`);

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && detail.length > 0 ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function findFreePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = createNetServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error(`no free port from ${start}`);
}

if (!existsSync(DIST_INDEX)) {
  console.error(`前端产物不存在：${DIST_INDEX}\n先跑 pnpm --filter web build`);
  process.exit(1);
}

const API_PORT = await findFreePort(4500);
const WEB_PORT = await findFreePort(API_PORT + 1);
const CDP_PORT = await findFreePort(WEB_PORT + 1);

process.env.PI_WEB_SIMPLE_HOME = HOME_DIR;
process.env.PI_WEB_SIMPLE_SESSION_DIR = SESSION_ROOT;
process.env.PI_WEB_SIMPLE_PORT = String(API_PORT);
process.env.PI_WEB_SIMPLE_OPEN = "0";

// ---------------------------------------------------------------- fixture ---

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(PROJECT_DIR, "src", "features", "conversation"), { recursive: true });
mkdirSync(HOME_DIR, { recursive: true });

/** 60 行，这样 `#L24-L30` 落在一个真实存在的区间里。 */
const APP_LINES = Array.from({ length: 60 }, (_, i) => `export const line${String(i + 1)} = ${String(i + 1)};`);
/** 500 行，让 `:396` 也需要真实的滚动定位。 */
const CONV_LINES = Array.from({ length: 500 }, (_, i) => `const step${String(i + 1)} = () => ${String(i + 1)};`);
/**
 * 1.4 MB, past the whole-file read cap (`TEXT_LIMIT`), so the preview pages it.
 *
 * This is the file that proves the other half of line addressing: a jump into a
 * long file is answered by the server's scan, not by reading pages until one
 * happens to cover the target.
 */
const BIG_LINES = Array.from(
  { length: 25_000 },
  (_, i) => `log line ${String(i + 1)} ${"x".repeat(40)}`,
);

writeFileSync(join(PROJECT_DIR, "src", "app.ts"), `${APP_LINES.join("\n")}\n`);
writeFileSync(join(PROJECT_DIR, "src", "features", "conversation", "useConversation.ts"), `${CONV_LINES.join("\n")}\n`);
writeFileSync(join(PROJECT_DIR, "big.log"), `${BIG_LINES.join("\n")}\n`);

/**
 * A real, visible picture — SVG so the fixture is text and the size is known.
 *
 * It is the file that proves the hover preview end to end: the chip only shows
 * one because the deployment calls the path an image, and the picture only
 * appears because `/raw` streams it to an `<img>` the browser decodes itself.
 */
const LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100" viewBox="0 0 180 100">',
  '  <rect width="180" height="100" rx="12" fill="#4f7cff"/>',
  '  <text x="90" y="58" font-family="monospace" font-size="16" fill="#fff" text-anchor="middle">preview</text>',
  "</svg>",
].join("\n");
writeFileSync(join(PROJECT_DIR, "logo.svg"), `${LOGO_SVG}\n`);

const projectPath = realpathSync(PROJECT_DIR);
const sessionDir = join(SESSION_ROOT, sanitizeProjectDirName(projectPath));
mkdirSync(sessionDir, { recursive: true });

/**
 * 回答里同时出现三条通道，正好是渲染器要分开处理的那三种：
 * 一个带 label 的链接、一个行内代码、一个同样长得像路径但本轮没碰过的词。
 */
const ANSWER = [
  "改动集中在 [the loader](src/app.ts#L24-L30)，发送循环在 `useConversation.ts:396`，" +
    "而 `not-a-file.ts` 只是普通代码。",
  "",
  // 同一个文件、两种 label：作者写了就用作者的，没写就用 basename 加行号。
  "再看 [src/app.ts:30](src/app.ts#L30) 这一处，以及 [](src/app.ts#L40)。",
  "",
  // 一个超过整文件读取上限的文件：预览会走分页，而定位仍要一次到位。
  "日志里最后一处异常在 `big.log:25000`。",
  "",
  // 一个图片引用：悬停就能看到图，不用先点开一个标签页。
  "截图也在 [the shot](logo.svg)。",
].join("\n");

const at = Date.now();
const iso = new Date(at).toISOString();
const sessionPath = join(sessionDir, "file-refs.jsonl");
writeFileSync(
  sessionPath,
  `${[
    { type: "session", version: 3, id: "file-refs", timestamp: iso, cwd: projectPath },
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: iso,
      message: { role: "user", content: "改了什么", timestamp: at },
    },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: iso,
      message: {
        role: "assistant",
        // The tool calls are the whole vocabulary: `read` names the two files,
        // so the answer's references are the ones the turn actually touched.
        content: [
          { type: "toolCall", id: "c1", name: "read", arguments: { path: "src/app.ts" } },
          {
            type: "toolCall",
            id: "c2",
            name: "read",
            arguments: { path: "src/features/conversation/useConversation.ts" },
          },
          { type: "toolCall", id: "c3", name: "read", arguments: { path: "big.log" } },
          { type: "toolCall", id: "c4", name: "read", arguments: { path: "logo.svg" } },
          { type: "text", text: ANSWER },
        ],
        timestamp: at,
      },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n")}\n`,
  "utf8",
);

writeFileSync(
  join(HOME_DIR, "store.json"),
  `${JSON.stringify(
    {
      version: 1,
      projects: [
        {
          id: "file-refs-project",
          path: projectPath,
          title: "file-refs-project",
          order: 0,
          createdAt: iso,
          updatedAt: iso,
        },
      ],
      sessionOverrides: {},
    },
    null,
    2,
  )}\n`,
);

// ------------------------------------------------------------ 真实 server ---

const { SessionRegistry } = await import("../server/src/registry.ts");
const { EventBus } = await import("../server/src/bus.ts");
const { createRequestHandler } = await import("../server/src/routes.ts");

const bus = new EventBus();
const registry = new SessionRegistry({ cliPath: LOAD_STUB, sessionDir: SESSION_ROOT, maxActiveSessions: 2 });
const handler = createRequestHandler({ registry, bus, sessionRoot: SESSION_ROOT });
const server = createServer((req, res) => {
  void handler(req, res);
});
await new Promise((resolve) => server.listen(API_PORT, "127.0.0.1", () => resolve()));
log(`server listening on ${API_PORT}`);

const viteBin = join(REPO, "web", "node_modules", ".bin", "vite");
const preview = spawn(viteBin, ["preview", "--port", String(WEB_PORT), "--strictPort"], {
  cwd: join(REPO, "web"),
  env: { ...process.env, PI_WEB_SIMPLE_PORT: String(API_PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
preview.stderr.setEncoding("utf8");
preview.stderr.on("data", (chunk) => process.stderr.write(`[preview] ${chunk}`));

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`no response from ${url}`);
}
await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 30_000);
log(`preview ready on ${WEB_PORT}`);

// ----------------------------------------------------------------- Chrome ---

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", () => undefined);

const target = await findChromeTarget(CDP_PORT);
const cdp = await CdpConnection.connect(target.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");

// 任何未捕获的异常都建到日志里：React 的定时器回调里的错误不会表现在 DOM 上。
cdp.on("Runtime.exceptionThrown", (params) => {
  const details = params?.exceptionDetails ?? {};
  log(`page exception: ${String(details.exception?.description ?? details.text ?? "")}`);
});

/** `/text` 请求计数：一次远行定位应该是一次，而不是一页一页走过去。 */
let textRequests = 0;
cdp.on("Network.requestWillBeSent", (params) => {
  const url = String(params?.request?.url ?? "");
  if (url.includes("/text?")) textRequests += 1;
});

async function waitForEval(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`!!(${predicate})`)) return true;
    await sleep(100);
  }
  log(`timeout waiting for ${label ?? predicate}`);
  return false;
}

const loadEvent = cdp.waitFor("Page.loadEventFired", { timeoutMs: 30_000 });
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/` });
await loadEvent;

if (!(await waitForEval(`document.querySelector('div[title=${JSON.stringify(projectPath)}]')`, 20_000, "project row"))) {
  throw new Error("侧栏里没有项目行");
}
// 项目行可能已经展开；只有会话行还没出现时才点它，免得把它折回去。
await waitForEval(
  `(() => {
     if (document.querySelector('div[title=${JSON.stringify(sessionPath)}] button')) return true;
     document.querySelector('div[title=${JSON.stringify(projectPath)}] button')?.click();
     return false;
   })()`,
  20_000,
  "session row",
);
await cdp.evaluate(`document.querySelector('div[title=${JSON.stringify(sessionPath)}] button').click()`);

// --------------------------------------------------------- 通道 1/2：chip ---

const ready = await waitForEval(`document.querySelector('[data-file-ref]')`, 20_000, "file chips");
check("回答里的文件引用渲染成了 chip", ready);

const chips = await cdp.evaluate(
  `[...document.querySelectorAll('[data-file-ref]')].map((el) => ({
     path: el.getAttribute('data-file-ref'),
     line: el.getAttribute('data-file-line'),
     text: el.textContent,
     tag: el.tagName,
   }))`,
);
const findChip = (chips, path, line) =>
  chips.find((chip) => chip.path === path && chip.line === String(line));
check(
  "带 label 的链接：label 保留，路径与行区间在属性上",
  findChip(chips, "src/app.ts", 24)?.text === "the loader",
  JSON.stringify(chips),
);
check(
  "同一个文件的第二个引用指向另一行，label 仍用作者写的文本",
  findChip(chips, "src/app.ts", 30)?.text === "src/app.ts:30",
  JSON.stringify(chips),
);
check(
  "空 label 的引用兜底成 basename 加行号",
  findChip(chips, "src/app.ts", 40)?.text === "app.ts:40",
  JSON.stringify(chips),
);
check(
  "行内代码被词汇表认出来（basename 唯一命中）",
  findChip(chips, "src/features/conversation/useConversation.ts", 396)?.text === "useConversation.ts:396",
  JSON.stringify(chips),
);
check("chip 是 button，不是链接", chips.every((chip) => chip.tag === "BUTTON"));

const plain = await cdp.evaluate(
  `[...document.querySelectorAll('code')].map((el) => el.textContent).filter((t) => t.includes('not-a-file'))`,
);
check("词汇表不认识的行内代码保持普通 code", plain.length === 1, JSON.stringify(plain));

// ------------------------------------------------- 图片引用的悬停预览 ---

const chipBox = await cdp.evaluate(
  `(() => {
     const chip = document.querySelector('[data-file-ref="logo.svg"]');
     if (chip === null) return null;
     const r = chip.getBoundingClientRect();
     return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
   })()`,
);
check("图片引用也是一枚 chip", chipBox !== null, JSON.stringify(chipBox));

/** 当前是否浮出了 logo.svg 的预览，以及图有没有真的解码出来。 */
async function previewState() {
  return cdp.evaluate(
    `(() => {
       const card = document.querySelector('[data-file-preview="logo.svg"]');
       const img = card === null ? null : card.querySelector('img');
       return card === null ? null : {
         src: img === null ? null : img.getAttribute('src'),
         loaded: img === null ? false : img.naturalWidth > 0,
       };
     })()`,
  );
}

if (chipBox !== null) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: chipBox.x,
    y: chipBox.y,
    buttons: 0,
  });
}

/**
 * Open the chip's hover preview.
 *
 * A real pointer would normally do this, and CDP can inject one — but headless
 * Chrome does not hit-test injected movement, so no `mouseover` is synthesized
 * and React's `onMouseEnter` never fires (the same reason `:hover` stays empty).
 * The handler is therefore *called*, read off the node as React attached it: the
 * real pointer path is already exercised by the clicks below, and what is under
 * test here is the delay, the placement and the picture itself.
 */
async function openHoverPreview(path: string): Promise<void> {
  await cdp.evaluate(`(() => {
    const chip = document.querySelector('[data-file-ref=${JSON.stringify(path)}]');
    if (chip === null) throw new Error('chip missing');
    const key = Object.keys(chip).find((name) => name.startsWith('__reactProps$'));
    if (key === undefined) throw new Error('no react props on the chip');
    chip[key].onMouseEnter();
    return true;
  })()`);
  // The preview opens after a deliberate delay (400ms); give it double.
  await sleep(900);
}

const previewUrl = await cdp.evaluate(
  `(() => {
     const chip = document.querySelector('[data-file-ref="logo.svg"]');
     return chip === null ? null : chip.getAttribute('data-file-preview-url');
   })()`,
);
check(
  "chip 上带着图片的预览地址",
  String(previewUrl ?? "").includes("/raw?path=logo.svg"),
  String(previewUrl),
);

// 会话加载后转录会自己滚到底部，而**滚动会关掉浮层**（这是设计：视口坐标在页面
// 移动后就不对了）。所以先等页面静下来再悬停，不然测的是那个关闭规则。
await sleep(500);

await openHoverPreview("logo.svg");
const hovered = await previewState();
check("悬停时浮出图片预览", hovered !== null, JSON.stringify(hovered));
check(
  "预览走 /raw，而不是把 base64 塞进 JSON",
  String(hovered?.src ?? "").includes("/raw?path=logo.svg"),
  JSON.stringify(hovered),
);
check("图片真的解码出来了", hovered?.loaded === true, JSON.stringify(hovered));
const hoverShot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(ROOT, "file-refs-hover.png"), Buffer.from(hoverShot.data, "base64"));

// ------------------------------------------------------- 打开与行定位 ---

const clickChip = (path, line) =>
  cdp.evaluate(`(() => {
    const chip = document.querySelector('[data-file-ref=${JSON.stringify(path)}][data-file-line=${JSON.stringify(String(line))}]');
    if (!chip) throw new Error("chip missing");
    chip.click();
    return true;
  })()`);

await clickChip("src/app.ts", 24);
check("点击 chip 打开了右栏预览", await waitForEval(`document.querySelector('[data-preview-auto-refresh]')`, 15_000, "preview pane"));
const opened = await waitForEval(
  `document.querySelector('[data-code-view] [data-line="24"][data-focus]')`,
  15_000,
  "line 24 focused",
);
check("预览按行渲染并高亮了引用要求的行", opened);

/** 目标行相对预览面板的位置：既要可见，也要落在这块面板的中间附近。 */
const geometry = await cdp.evaluate(`(() => {
  const row = document.querySelector('[data-code-view] [data-line="24"]');
  const pane = document.querySelector('[data-rb-pane]');
  if (!row || !pane) return null;
  const r = row.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  return {
    visible: r.top >= p.top && r.bottom <= p.bottom,
    offset: Math.round((r.top + r.bottom) / 2 - (p.top + p.bottom) / 2),
    text: row.textContent,
    paneHeight: Math.round(p.height),
  };
})()`);
check("目标行滚进了可视区", geometry?.visible === true, JSON.stringify(geometry));
check("目标行落在面板中间附近（scrollIntoView block:center）", Math.abs(geometry?.offset ?? 9999) < 120, JSON.stringify(geometry));
check("读出来的是那一行的内容", String(geometry?.text ?? "").includes("line24"), JSON.stringify(geometry));

const tabCount = () => cdp.evaluate(`document.querySelectorAll('[data-rb-tab]').length`);
check("同文件只开了一个标签页", (await tabCount()) === 1, String(await tabCount()));

// 同一个文件的另一行：位置移动，标签页不增加。
await clickChip("src/app.ts", 30);
check(
  "第二次点同一文件的另一行，标签页没有变多",
  await waitForEval(`document.querySelector('[data-code-view] [data-line="30"][data-focus]')`, 15_000, "line 30 focused"),
);
check("仍然只有一个预览标签页", (await tabCount()) === 1, String(await tabCount()));

// 另一个文件：第二个标签页。
await clickChip("src/features/conversation/useConversation.ts", 396);
check(
  "另一个文件的引用开在第二个标签页上",
  await waitForEval(`document.querySelector('[data-code-view] [data-line="396"][data-focus]')`, 15_000, "line 396 focused"),
);
check("标签页数量变成 2", (await tabCount()) === 2, String(await tabCount()));

const coloured = await cdp.evaluate(
  `document.querySelector('[data-code-view] [data-line="396"] span[style*="--shiki"]') !== null`,
);
check("按行渲染的同时也上了语法色（shiki 逐行）", coloured === true, String(coloured));

// 两张诊断图：一张是带语法色的行视图，一张是最后那个分页的大文件。
const linesShot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(join(ROOT, "file-refs-lines.png"), Buffer.from(linesShot.data, "base64"));

// ------------------------------------------------- 大文件：一次扫描到位 ---

textRequests = 0;
await clickChip("big.log", 25_000);
check(
  "分页的大文件也能定位到目标行",
  await waitForEval(
    `document.querySelector('[data-code-view] [data-line="25000"][data-focus]')`,
    20_000,
    "line 25000 focused",
  ),
);
const bigLine = await cdp.evaluate(
  `(() => {
     const row = document.querySelector('[data-code-view] [data-line="25000"]');
     return row === null ? null : row.textContent;
   })()`,
);
check(
  "行号是文件里的行号，不是页内行号",
  String(bigLine ?? "").includes("log line 25000"),
  JSON.stringify(bigLine),
);
check("远行定位只读一页（服务端扫描，不是逐页追）", textRequests === 1, `${String(textRequests)} 次 /text 请求`);

// ------------------------------------------------------------- 截图与收尾 ---

const shotPath = join(ROOT, "file-refs.png");
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
log(`截图 → ${ROOT}`);

console.log(`\n${failures === 0 ? "全部通过" : `${String(failures)} 项失败`}`);

cdp.close();
chrome.kill("SIGTERM");
preview.kill("SIGTERM");
await registry.closeAll("file-refs");
await new Promise((resolve) => server.close(() => resolve()));
await sleep(500);
if (process.env.FILE_REFS_KEEP === "1") log(`临时目录保留在 ${ROOT}`);
else rmSync(ROOT, { recursive: true, force: true });

process.exit(failures === 0 ? 0 : 1);
