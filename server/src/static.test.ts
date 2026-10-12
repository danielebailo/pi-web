import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticHandler } from "./static.ts";

/**
 * Static serving, as the two callers see it.
 *
 * The handler answers `true` when it wrote a response and `false` when it did
 * not, and the router behind it turns the `false` into its JSON 404 — so what a
 * test has to pin is which paths land in which bucket, in particular the one
 * that used to land wrong: a fingerprinted asset the build no longer has.
 */

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>\n';
const APP_JS = "export const one = 1;\n";

let root: string;
let server: Server;
let baseUrl: string;
/** Paths the handler refused, so the wrapper below can answer its 404. */
const refused: string[] = [];

beforeAll(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "piws-static-")));
  root = join(base, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), INDEX_HTML);
  await writeFile(join(root, "assets", "app-abc123.js"), APP_JS);

  const handler = createStaticHandler(root);
  if (handler === null) throw new Error("the handler did not build");

  // The same shape `routes.ts` gives it: the built front end gets first
  // refusal, and only a `false` becomes a 404.
  server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    void handler(req, res, pathname).then((handled) => {
      if (handled) return;
      refused.push(pathname);
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `no route for ${req.method} ${pathname}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

describe("static handler", () => {
  it("boots the shell for a deep link", async () => {
    const response = await fetch(`${baseUrl}/sessions/some-id`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    // The shell points at the current fingerprints, so it must never be held
    // past the build that produced it.
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it("serves a fingerprinted asset as immutable", async () => {
    const response = await fetch(`${baseUrl}/assets/app-abc123.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe(APP_JS);
  });

  it("404s a fingerprinted asset the build no longer has", async () => {
    // The desktop shell serves a directory every `pnpm build` rewrites, so a
    // window can outlive the fingerprint it was loaded with. The one answer
    // that must not happen is `200 text/html`: a dynamic import cannot read it,
    // and that failure is what blanks the window (`web/src/lib/stale-chunk.ts`
    // is the page's half of the same story).
    const response = await fetch(`${baseUrl}/assets/app-gone999.js`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(refused).toContain("/assets/app-gone999.js");
  });

  it("leaves a path that merely looks like the asset prefix to the shell", async () => {
    const response = await fetch(`${baseUrl}/assets-old/thing`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(refused).not.toContain("/assets-old/thing");
  });
});
