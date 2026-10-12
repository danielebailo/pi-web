/**
 * 场景 D — 切换会话的加载成本。
 *
 * 场景 C 测的是「同一个会话流式输出」的主线程成本。真实使用里另一件常做的事是
 * **切会话**：点侧栏另一条会话 → 服务端读 JSONL（同步 `SessionManager.open` +
 * 构建 + 序列化）→ 前端 `JSON.parse` → React 把整条转录挂上 DOM。这条链路的成本
 * 随文件大小增长，在大会话上表现为点下去之后页面卡一下。
 *
 * 本脚本用真实前端产物 + 真实 Chrome（CDP），量「点击 → 转录出现」这段墙钟时间
 * 以及窗口内的 longtask / React commit，并单独量服务端两个接口（/messages、
 * /composer）的耗时。pi 进程完全不起（非驻留会话走磁盘），零 LLM 成本。
 *
 * 用法（先构建前端）：
 *   pnpm --filter web build
 *   cd server && ./node_modules/.bin/tsx ../bench/scenario-d-switch.ts
 *
 * 环境变量：
 *   D_TURNS        目标会话的轮数（默认 200）
 *   D_SMALL_TURNS  对照组会话的轮数（默认 10）
 *   D_IMAGE_EVERY  目标会话每 N 条 user 消息带一张假图（默认 0）
 *   D_IMAGE_KB     每张假图的 base64 字符数（默认 0；写 1500000 ≈ 1.5MB）
 *   D_ROUNDS       来回切换的轮数（默认 4）
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpConnection, findChromeTarget } from "./lib/cdp.mjs";
import { sanitizeProjectDirName, writeSessionFile } from "./lib/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const ROOT = join(HERE, ".bench-tmp", `switch-${process.pid}`);
const PROJECT_DIR = join(ROOT, "project");
const HOME_DIR = join(ROOT, "home");
const SESSION_ROOT = join(ROOT, "sessions");
const CHROME_PROFILE = join(ROOT, "chrome-profile");

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

const API_PORT = await findFreePort(4500);
const WEB_PORT = await findFreePort(API_PORT + 1);
const CDP_PORT = await findFreePort(WEB_PORT + 1);
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LOAD_STUB = join(HERE, "load-stub.mjs");
const DIST_INDEX = join(REPO, "web", "dist", "index.html");

const TURNS = Number(process.env.D_TURNS ?? 200);
const SMALL_TURNS = Number(process.env.D_SMALL_TURNS ?? 10);
const IMAGE_EVERY = Number(process.env.D_IMAGE_EVERY ?? 0);
const IMAGE_CHARS = Number(process.env.D_IMAGE_KB ?? 0);
const ROUNDS = Number(process.env.D_ROUNDS ?? 4);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.error(`[d] ${message}`);

process.env.PI_WEB_SIMPLE_HOME = HOME_DIR;
process.env.PI_WEB_SIMPLE_SESSION_DIR = SESSION_ROOT;
process.env.PI_WEB_SIMPLE_PORT = String(API_PORT);

if (!existsSync(DIST_INDEX)) {
  console.error(`前端产物不存在：${DIST_INDEX}\n先跑 pnpm --filter web build`);
  process.exit(1);
}

// ---------------------------------------------------------------- fixture ---

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(PROJECT_DIR, { recursive: true });
mkdirSync(HOME_DIR, { recursive: true });

const projectPath = realpathSync(PROJECT_DIR);
const sessionDir = join(SESSION_ROOT, sanitizeProjectDirName(projectPath));
const startedAt = Date.now();

const targetSession = writeSessionFile(sessionDir, {
  fileName: "bench-target.jsonl",
  id: "bench-target",
  cwd: projectPath,
  turns: TURNS,
  label: " [TARGET]",
  startedAt: startedAt - 3600_000,
  imageEvery: IMAGE_EVERY,
  imageChars: IMAGE_CHARS,
});
const smallSession = writeSessionFile(sessionDir, {
  fileName: "bench-small.jsonl",
  id: "bench-small",
  cwd: projectPath,
  turns: SMALL_TURNS,
  label: " [SMALL]",
  startedAt,
});

const TARGET_MARKER = `回答 ${TURNS} [TARGET]`;
const SMALL_MARKER = `回答 ${SMALL_TURNS} [SMALL]`;

writeFileSync(
  join(HOME_DIR, "store.json"),
  `${JSON.stringify(
    {
      version: 1,
      projects: [
        {
          id: "bench-project",
          path: projectPath,
          title: "bench-project",
          order: 0,
          createdAt: new Date(startedAt).toISOString(),
          updatedAt: new Date(startedAt).toISOString(),
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
const registry = new SessionRegistry({ cliPath: LOAD_STUB, sessionDir: SESSION_ROOT, maxActiveSessions: 8 });
const handler = createRequestHandler({ registry, bus, sessionRoot: SESSION_ROOT });
const server = createServer((req, res) => {
  void handler(req, res);
});
await new Promise((resolve) => server.listen(API_PORT, "127.0.0.1", () => resolve()));
log(`server listening on ${API_PORT}`);

// 端点延迟：/messages 与切会话时并发发出的 /composer。
// 第一轮先发“并发的一对”，代表一次真实切会话（两个请求同时、缓存全冷）；
// 其后的轮次重复同一对，看共享解析之后暖缓存的代价。
async function timeEndpoints(sessionPath, rounds = 5) {
  const base = `http://127.0.0.1:${API_PORT}/api/sessions/${encodeURIComponent(sessionPath)}`;
  const pair = () =>
    Promise.all([
      fetch(`${base}/messages`).then((r) => r.arrayBuffer()),
      fetch(`${base}/composer`).then((r) => r.arrayBuffer()),
    ]);
  const both = [];
  for (let i = 0; i < rounds; i += 1) {
    const t0 = performance.now();
    await pair();
    both.push(performance.now() - t0);
  }
  const solo = async (route) => {
    const t0 = performance.now();
    const response = await fetch(`${base}/${route}`);
    const bytes = (await response.arrayBuffer()).byteLength;
    return { ms: performance.now() - t0, bytes };
  };
  const messages = [];
  const composer = [];
  for (let i = 0; i < rounds; i += 1) messages.push(await solo("messages"));
  for (let i = 0; i < rounds; i += 1) composer.push(await solo("composer"));
  const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  return {
    // The first pair is the cold switch; the rest share whatever it parsed.
    bothColdMs: Math.round(both[0]),
    bothWarmMs: Math.round(median(both.slice(1))),
    messagesWarmMs: Math.round(median(messages.map((m) => m.ms))),
    messagesBytes: median(messages.map((m) => m.bytes)),
    composerWarmMs: Math.round(median(composer.map((c) => c.ms))),
  };
}

// --------------------------------------------------------------- 前端预览 ---

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
      const response = await fetch(url);
      if (response.ok) return;
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
await cdp.send("Performance.enable");
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: readFileSync(join(HERE, "frontend-measure.js"), "utf8"),
});

async function waitForEval(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`!!(${predicate})`)) return true;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${label ?? predicate}`);
}

const loadEvent = cdp.waitFor("Page.loadEventFired", { timeoutMs: 30_000 });
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/` });
await loadEvent;
await waitForEval("window.__bench", 10_000, "measure probe");

await waitForEval(
  `document.querySelector('div[title=${JSON.stringify(projectPath)}]')`,
  20_000,
  "project row",
);
// 工作区可能默认已展开；只有在会话行还没出现时才点它，避免把它折叠回去。
await waitForEval(
  `(() => {
     if (document.querySelector('div[title=${JSON.stringify(smallSession)}] button')) return true;
     const project = document.querySelector('div[title=${JSON.stringify(projectPath)}] button');
     if (project) project.click();
     return false;
   })()`,
  20_000,
  "session rows",
);
const sidebarText = await cdp.evaluate("document.body.innerText.slice(0, 400)");
if (!String(sidebarText).includes("bench-small")) {
  console.error(`[d] sidebar text: ${JSON.stringify(sidebarText)}`);
}

const clickSession = (sessionPath) =>
  cdp.evaluate(`(() => {
    const row = document.querySelector('div[title=${JSON.stringify(sessionPath)}] button');
    if (!row) throw new Error("session row missing");
    row.click();
    return true;
  })()`);

/** 把 CDP CPU profile 按「函数 + 文件」聚合自身耗时（微秒），并分离 idle。 */
function aggregateProfile(profile, topN) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let idleMicros = 0;
  let totalMicros = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const node = byId.get(samples[i]);
    if (!node) continue;
    const delta = deltas[i] ?? 0;
    totalMicros += delta;
    const frame = node.callFrame;
    const name = frame.functionName || "(anonymous)";
    if (name === "(idle)") {
      idleMicros += delta;
      continue;
    }
    const url = frame.url ? new URL(frame.url).pathname.split("/").pop() : "(vm)";
    const key = `${name} @ ${url}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + delta);
  }
  return {
    top: [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([key, micros]) => ({ key, ms: Math.round(micros / 1000) })),
    idleMs: Math.round(idleMicros / 1000),
    totalMs: Math.round(totalMicros / 1000),
  };
}

async function switchOnce(fromPath, toPath, marker, { profile = false } = {}) {
  await clickSession(fromPath);
  await waitForEval(`!document.body.innerText.includes(${JSON.stringify(marker)})`, 20_000, "left target");
  await sleep(400);
  await cdp.evaluate("window.__benchReset()");
  if (profile) await cdp.send("Profiler.start");
  await cdp.evaluate("window.__clickAt = performance.now()");
  const t0 = Date.now();
  await clickSession(toPath);
  await waitForEval(`document.body.innerText.includes(${JSON.stringify(marker)})`, 60_000, "target rendered");
  // 真正“看到”的判据：让浏览器先拿到一次 rAF。主线程假设被后续渲染占住，
  // 这个 promise 就会拖到渲染结束后才兑现（比 innerText 更接近用户感知）。
  const paintAt = await cdp.evaluate(
    "new Promise((r) => requestAnimationFrame((t) => r(Math.round(t))))",
  );
  const clickAtPage = await cdp.evaluate("window.__clickAt");
  const paintMs = Math.max(0, Math.round(paintAt - clickAtPage));
  await cdp.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  const tailMs = Date.now() - t0;
  const tailSnap = await cdp.evaluate("window.__benchSnapshot()");

  // 渐进渲染下，尾部先出现，前面几轮在后台补上。
  // 注意第一轮的标志必须带目标会话的 label——小会话也有一个 data-turn="1"。
  let fullMs = tailMs;
  let fullSnap = tailSnap;
  try {
    await waitForEval(
      `(() => { const row = document.querySelector('[data-turn="1"]'); return !!row && row.innerText.includes('[TARGET]'); })()`,
      30_000,
      "first target turn mounted",
    );
    fullMs = Date.now() - t0;
    fullSnap = await cdp.evaluate("window.__benchSnapshot()");
  } catch {
    // 单轮会话没有“补齐”阶段，保持 tail 的值。
  }

  let profiling = null;
  if (profile) {
    const { profile: cpu } = await cdp.send("Profiler.stop");
    profiling = aggregateProfile(cpu, 8);
  }
  const total = (snap) => snap.longTasks.reduce((sum, t) => sum + t.duration, 0);
  const clickAt = await cdp.evaluate("window.__clickAt");
  const timeline = tailSnap.longTasks.map((t) => ({
    at: Math.round(t.start - clickAt),
    ms: Math.round(t.duration),
  }));
  return {
    wallMs: tailMs,
    paintMs,
    fullMs,
    reactCommits: tailSnap.reactCommits,
    longTaskCount: tailSnap.longTasks.length,
    longTaskTotalMs: Math.round(total(tailSnap)),
    longTaskMaxMs: Math.round(tailSnap.longTasks.reduce((max, t) => Math.max(max, t.duration), 0)),
    catchupLongTaskMs: Math.round(total(fullSnap) - total(tailSnap)),
    longTasks: timeline,
    busyMs: profiling ? profiling.totalMs - profiling.idleMs : null,
    topFunctions: profiling ? profiling.top : null,
  };
}

console.log("=".repeat(96));
console.log("场景 D：切换会话的加载成本（真实 Chrome headless + 生产构建）");
console.log("=".repeat(96));
console.log(
  `目标会话 ${TURNS} 轮${IMAGE_EVERY > 0 ? `（每 ${IMAGE_EVERY} 条 user 带 ${(IMAGE_CHARS / 1e6).toFixed(2)}MB 假图）` : ""}，` +
    `对照会话 ${SMALL_TURNS} 轮`,
);
console.log("");

const endpoint = await timeEndpoints(targetSession, 5);
console.log(
  `服务端端点：切会话那一对（冷）${endpoint.bothColdMs}ms；重复同一对（暖）${endpoint.bothWarmMs}ms；` +
    `单独的 /messages ${endpoint.messagesWarmMs}ms、${(endpoint.messagesBytes / 1e6).toFixed(1)}MB，` +
    `/composer ${endpoint.composerWarmMs}ms`,
);

// 基线：切换到一个同样很小的会话。
const baseline = await switchOnce(targetSession, smallSession, SMALL_MARKER, { profile: true });

const switches = [];
for (let i = 0; i < ROUNDS; i += 1) {
  switches.push(await switchOnce(smallSession, targetSession, TARGET_MARKER, { profile: i === 0 }));
}
switches.sort((a, b) => a.wallMs - b.wallMs);
const worst = switches[switches.length - 1];
const median = switches[Math.floor(switches.length / 2)];

// 正确性检查：渐进渲染下往上滚不应该撞到“墙”——滚到已挂载区的顶部，
// 前面的轮次必须补上（走 onScroll 的 TOP_BACKFILL 分支）。
let scrollUpOk = null;
let scrollUpMs = null;
try {
  await clickSession(smallSession);
  await sleep(300);
  await clickSession(targetSession);
  await waitForEval(`document.body.innerText.includes(${JSON.stringify(TARGET_MARKER)})`, 60_000, "target tail");
  // 恢复窗口：确保还有未挂载的前缀。
  const stillWindowed = await cdp.evaluate(
    `!document.querySelector('[data-turn="1"]') || !document.querySelector('[data-turn="1"]').innerText.includes('[TARGET]')`,
  );
  const t0 = Date.now();
  await cdp.evaluate(`(() => {
    const row = document.querySelector('[data-turn]');
    const scroller = row && row.parentElement && row.parentElement.parentElement;
    if (!scroller) return false;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  })()`);
  await waitForEval(
    `(() => { const row = document.querySelector('[data-turn="1"]'); return !!row && row.innerText.includes('[TARGET]'); })()`,
    30_000,
    "scroll-up mounts the head",
  );
  scrollUpMs = Date.now() - t0;
  scrollUpOk = true;
  if (stillWindowed) scrollUpOk = true;
} catch (err) {
  scrollUpOk = false;
  scrollUpMs = null;
  console.error(`[d] scroll-up check failed: ${err.message}`);
}

const pad = (v, w) => String(v).padEnd(w);
console.log("");
console.log(
  pad("方向", 22) + pad("点击→尾部", 12) + pad("点击→首帧", 12) + pad("点击→全量", 12) + pad("longtask 合计", 15) + pad("最长一次", 10) + pad("补齐耗时", 10),
);
console.log("-".repeat(108));
console.log(
  pad(`小会话（${SMALL_TURNS} 轮）`, 22) +
    pad(`${baseline.wallMs}ms`, 12) +
    pad(`${baseline.paintMs}ms`, 12) +
    pad(`${baseline.fullMs}ms`, 12) +
    pad(`${baseline.longTaskTotalMs}ms`, 15) +
    pad(`${baseline.longTaskMaxMs}ms`, 10) +
    pad(`${baseline.catchupLongTaskMs}ms`, 10),
);
console.log(
  pad(`目标会话（${TURNS} 轮）中位`, 22) +
    pad(`${median.wallMs}ms`, 12) +
    pad(`${median.paintMs}ms`, 12) +
    pad(`${median.fullMs}ms`, 12) +
    pad(`${median.longTaskTotalMs}ms`, 15) +
    pad(`${median.longTaskMaxMs}ms`, 10) +
    pad(`${median.catchupLongTaskMs}ms`, 10),
);
console.log(
  pad(`目标会话（${TURNS} 轮）最差`, 22) +
    pad(`${worst.wallMs}ms`, 12) +
    pad(`${worst.paintMs}ms`, 12) +
    pad(`${worst.fullMs}ms`, 12) +
    pad(`${worst.longTaskTotalMs}ms`, 15) +
    pad(`${worst.longTaskMaxMs}ms`, 10) +
    pad(`${worst.catchupLongTaskMs}ms`, 10),
);
console.log("");
console.log(
  `向上滚到已挂载顶部时补齐前面轮次：${scrollUpOk ? `OK（${scrollUpMs}ms）` : "FAILED"}`,
);
console.log("点击→尾部 = 到转录最后一行文字进入 DOM；点击→首帧 = 主线程空下来、真能画一帧（用户感知的“出来了”）。");
console.log("点击→全量 = 到第一个 turn 也挂上 DOM 的时间（渐进渲染补齐）。");
console.log("longtask = 首屏窗口内主线程单次阻塞 >50ms 的事件；补齐耗时 = 首屏之后补齐阶段的长任务合计。");
if (median.topFunctions) {
  console.log("");
  console.log(`【切换到目标会话】主线程 top 自耗时（busy ${median.busyMs}ms）：`);
  for (const fn of median.topFunctions) console.log(`    ${String(fn.ms).padStart(5)}ms  ${fn.key}`);
}
const profiled = switches.find((s) => s.longTasks);
if (profiled) {
  console.log("");
  console.log("首屏窗口内的 longtask 时间线（相对点击的 ms）：");
  for (const t of profiled.longTasks) console.log(`    点击后 ${String(t.at).padStart(4)}ms  阻塞 ${t.ms}ms`);
}

const outFile = join(HERE, "results", "scenario-d.json");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      turns: TURNS,
      smallTurns: SMALL_TURNS,
      imageEvery: IMAGE_EVERY,
      imageChars: IMAGE_CHARS,
      endpoint,
      baseline,
      median,
      worst,
      switches,
      scrollUp: { ok: scrollUpOk, ms: scrollUpMs },
    },
    null,
    2,
  )}\n`,
);
console.log(`\n原始数据 → ${outFile}`);

cdp.close();
chrome.kill("SIGTERM");
preview.kill("SIGTERM");
await registry.closeAll("bench");
await new Promise((resolve) => server.close(() => resolve()));
await sleep(500);
rmSync(ROOT, { recursive: true, force: true });
