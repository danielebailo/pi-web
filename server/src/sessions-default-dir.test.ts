import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let agentDir: string;
let projectCwd: string;
let sessionDir: string;
let sessions: typeof import("./sessions.ts");
let previousAgentDir: string | undefined;
let previousSessionDir: string | undefined;

/**
 * The layout the rest of the suite never reaches.
 *
 * `routes.ts` hands `listSessions` the directory it derives for the project,
 * which — with no `PI_WEB_SIMPLE_SESSION_DIR` override — is exactly pi's own
 * default for that project. pi does not filter such a listing by the session's
 * header cwd (`SessionManager.list` skips that filter for the directory it
 * would have derived itself), while the scratch directory the fast path stages
 * is always filtered. A session whose header names some other cwd — an older
 * layout, a moved project — therefore has to survive the fast path, and this
 * pins the fallback that keeps it.
 */
beforeAll(async () => {
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  previousSessionDir = process.env.PI_WEB_SIMPLE_SESSION_DIR;
  agentDir = await realpath(await mkdtemp(join(tmpdir(), "piws-agent-dir-")));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_WEB_SIMPLE_SESSION_DIR;

  projectCwd = await realpath(await mkdtemp(join(tmpdir(), "piws-default-cwd-")));
  const { sessionDirFor } = await import("./session-path.ts");
  sessionDir = sessionDirFor(projectCwd);
  await mkdir(sessionDir, { recursive: true });
  sessions = await import("./sessions.ts");
});

afterAll(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousSessionDir === undefined) delete process.env.PI_WEB_SIMPLE_SESSION_DIR;
  else process.env.PI_WEB_SIMPLE_SESSION_DIR = previousSessionDir;
  await rm(agentDir, { recursive: true, force: true });
  await rm(projectCwd, { recursive: true, force: true });
});

/** Minimal but faithful pi session file: header + one user message. */
async function writeSession(
  fileName: string,
  options: { id: string; cwd: string; message: string; timestamp: string },
): Promise<string> {
  const path = join(sessionDir, fileName);
  const epoch = Date.parse(options.timestamp);
  const rows = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: options.id,
      timestamp: options.timestamp,
      cwd: options.cwd,
    }),
    JSON.stringify({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: options.timestamp,
      message: { role: "user", content: options.message, timestamp: epoch },
    }),
  ];
  await writeFile(path, `${rows.join("\n")}\n`, "utf8");
  const when = new Date(epoch + 1000);
  await utimes(path, when, when);
  return path;
}

describe("pi's own default session directory", () => {
  it("lists a session whose header cwd differs from the project", async () => {
    await writeSession("belongs.jsonl", {
      id: "1111aaaa-1111-1111-1111-111111111111",
      cwd: projectCwd,
      message: "belongs here",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    await sessions.listSessions(projectCwd, { sessionDir });

    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "piws-elsewhere-")));
    await writeSession("elsewhere.jsonl", {
      id: "2222bbbb-2222-2222-2222-222222222222",
      cwd: elsewhere,
      message: "different cwd",
      timestamp: "2026-02-01T00:00:00.000Z",
    });

    // The premise the fast path depends on: this directory is pi's default for
    // the project, so pi lists the foreign session rather than filtering it. If
    // this ever stops holding, the fallback below is not being exercised.
    const fromPi = await SessionManager.list(projectCwd, sessionDir);
    expect(fromPi.map((info) => info.path)).toContain(join(sessionDir, "elsewhere.jsonl"));

    const parsed = vi.spyOn(SessionManager, "list");
    try {
      const { sessions: list, total } = await sessions.listSessions(projectCwd, { sessionDir });
      expect(list.map((s) => s.title)).toEqual(["different cwd", "belongs here"]);
      expect(total).toBe(2);
      // The staged directory once, then the real one to settle the file it
      // could not answer for.
      expect(parsed).toHaveBeenCalledTimes(2);

      // And that settled answer is kept: no repeated fallback from here on.
      await sessions.listSessions(projectCwd, { sessionDir });
      expect(parsed).toHaveBeenCalledTimes(2);
    } finally {
      parsed.mockRestore();
    }

    await rm(elsewhere, { recursive: true, force: true });
  });
});
