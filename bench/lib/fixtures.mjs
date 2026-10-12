/**
 * 场景 C 的 fixture：一个临时工作区 + N 个 pi 会话 JSONL。
 *
 * JSONL 格式对齐 pi 自己的会话文件（header + message 行），这样
 * `SessionManager.list` / `buildSessionContext` 能像读真实会话一样读它们，
 * 前端走的也是同一条历史加载路径（`GET /api/sessions/:id/messages`）。
 */
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** pi 的会话目录命名：cwd 去掉前导 /，把分隔符换成 -，两侧补 --。 */
export function sanitizeProjectDirName(cwd) {
  const resolved = resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

const PARAGRAPHS = [
  "我们把读取路径重写成了流式解析，这样首屏不用等整份文件。",
  "这个改动会让内存占用从 O(消息数) 降到 O(单条消息)，但需要保证 chunk 边界不会被切开。",
  "边界处理用了一个显式的 buffer 拼接，避免 split 在残行上产生幻觉数据。",
  "另一个取舍是错误恢复：解析失败时保留已收到的部分，而不是整段丢弃。",
];

const CODE = [
  "```ts",
  "export function fold(events: Event[]): View {",
  "  return events.reduce(apply, emptyView());",
  "}",
  "```",
].join("\n");

function userText(index) {
  return `第 ${index} 轮：解释一下 ${PARAGRAPHS[index % PARAGRAPHS.length]}`;
}

function assistantText(index, label = "") {
  const body = [
    `### 回答 ${index}${label}`,
    "",
    PARAGRAPHS[(index + 1) % PARAGRAPHS.length],
    "",
    PARAGRAPHS[(index + 2) % PARAGRAPHS.length],
    "",
    CODE,
    "",
    `结论：${PARAGRAPHS[(index + 3) % PARAGRAPHS.length]}`,
  ].join("\n");
  return body;
}

/** A fake but plausibly-shaped base64 blob, for measuring payload cost. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function fakeBase64(chars) {
  let out = "";
  for (let i = 0; i < chars; i += 1) out += B64[(i * 7 + 3) % B64.length];
  return out;
}

/**
 * 写一个会话文件。`turns` 为来回轮数，每条 = user + assistant，
 * 所以最终消息数是 turns * 2。
 */
export function writeSessionFile(
  dir,
  {
    fileName,
    id,
    cwd,
    turns,
    startedAt = Date.now(),
    /** Appended to every assistant reply, so a caller can spot this session's text. */
    label = "",
    /** Add a fake base64 image to every Nth user message (0 = none). */
    imageEvery = 0,
    /** How many base64 characters each fake image carries. */
    imageChars = 0,
  },
) {
  const rows = [JSON.stringify({ type: "session", version: 3, id, timestamp: new Date(startedAt).toISOString(), cwd })];
  let parentId = null;
  let at = startedAt;
  const image = fakeBase64(imageChars);

  for (let index = 1; index <= turns; index += 1) {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    const userIso = new Date(at).toISOString();
    at += 1000;
    rows.push(
      JSON.stringify({
        type: "message",
        id: userId,
        parentId,
        timestamp: userIso,
        message: {
          role: "user",
          content: userText(index),
          timestamp: Date.parse(userIso),
        },
      }),
    );

    // Images ride in a tool result, which is where a real session's weight is:
    // a screenshot a `read` returned, and the one the transcript now hands out
    // as a URL instead of inline (see `server/src/session-images.ts`).
    const withImage = imageEvery > 0 && index % imageEvery === 0;
    const callId = `call-${index}`;
    const assistantIso = new Date(at).toISOString();
    at += 1000;
    rows.push(
      JSON.stringify({
        type: "message",
        id: assistantId,
        parentId: userId,
        timestamp: assistantIso,
        message: {
          role: "assistant",
          content: withImage
            ? [
                { type: "toolCall", id: callId, name: "read", arguments: { path: `shot-${index}.png` } },
                { type: "text", text: assistantText(index, label) },
              ]
            : [{ type: "text", text: assistantText(index, label) }],
          timestamp: Date.parse(assistantIso),
        },
      }),
    );

    if (withImage) {
      const toolId = `t${index}`;
      const toolIso = new Date(at).toISOString();
      at += 1000;
      rows.push(
        JSON.stringify({
          type: "message",
          id: toolId,
          parentId: assistantId,
          timestamp: toolIso,
          message: {
            role: "toolResult",
            toolCallId: callId,
            toolName: "read",
            content: [{ type: "image", mimeType: "image/png", data: image }],
            isError: false,
            timestamp: Date.parse(toolIso),
          },
        }),
      );
      parentId = toolId;
    } else {
      parentId = assistantId;
    }
  }

  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  writeFileSync(path, `${rows.join("\n")}\n`, "utf8");
  const when = new Date(at);
  utimesSync(path, when, when);
  return path;
}
