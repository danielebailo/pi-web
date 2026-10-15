import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "@earendil-works/pi-coding-agent";
import {
  UpdatesConfigError,
  clearUpdateCache,
  compareVersions,
  isNewerVersion,
  readUpdates,
  updateApp,
  updateExtension,
  type PackageUpdateSource,
} from "./updates.ts";

/**
 * Both sides of this module leave the process, so both are injected: `fetch`
 * for the two endpoints (pi's release endpoint, and the npm registry for this
 * project), and pi's package manager for the installed-package check. Without
 * that the suite would depend on the network and on npm being able to spawn,
 * which is exactly the flakiness the seam exists to avoid.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PI_RELEASE_URL = "https://pi.dev/api/latest-version";
const APP_REGISTRY_URL = "https://registry.npmjs.org/pi-web-simple/latest";

function fetchStub(
  release: unknown,
  options: { status?: number; fail?: boolean; app?: unknown } = {},
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (options.fail === true) {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      });
    }
    // The registry default is a version nobody can beat, so tests that are
    // about pi do not have to spell out "and the project is current".
    const body = url === APP_REGISTRY_URL ? (options.app ?? { version: "0.0.0" }) : release;
    return jsonResponse(body, options.status ?? 200);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function packageStub(
  updates: { source: string; displayName: string; type: "npm" | "git"; scope: string }[],
  onUpdate?: (source: string | undefined) => void,
): PackageUpdateSource & { updateCalls: (string | undefined)[] } {
  const updateCalls: (string | undefined)[] = [];
  return {
    updateCalls,
    async checkForAvailableUpdates() {
      return updates;
    },
    async update(source?: string) {
      updateCalls.push(source);
      onUpdate?.(source);
    },
  };
}

beforeEach(() => {
  clearUpdateCache();
});

afterEach(() => {
  delete process.env.PI_OFFLINE;
  delete process.env.PI_SKIP_VERSION_CHECK;
});

describe("compareVersions", () => {
  it("orders releases by major, minor, then patch", () => {
    expect(compareVersions("0.87.0", "0.86.1")).toBeGreaterThan(0);
    expect(compareVersions("0.86.0", "0.86.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.86.1")).toBeGreaterThan(0);
  });

  it("treats a release as newer than any prerelease of the same version", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("compares prerelease identifiers, numbers numerically", () => {
    expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10")).toBeLessThan(0);
    // A shorter list sorts first, and numeric identifiers sort below text ones.
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
  });

  it("reports equal versions and tolerates a leading v or build metadata", () => {
    expect(compareVersions("0.86.1", "0.86.1")).toBe(0);
    expect(compareVersions("v0.86.1", "0.86.1")).toBe(0);
    expect(compareVersions("0.86.1+build.5", "0.86.1")).toBe(0);
  });

  it("returns null for tags it cannot order", () => {
    expect(compareVersions("nightly", "0.86.1")).toBeNull();
    expect(compareVersions("0.86", "0.86.1")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("is true only for a strictly newer parseable version", () => {
    expect(isNewerVersion("0.87.0", "0.86.1")).toBe(true);
    expect(isNewerVersion("0.86.1", "0.86.1")).toBe(false);
    expect(isNewerVersion("0.86.0", "0.86.1")).toBe(false);
    // An unorderable tag must not be announced as newer.
    expect(isNewerVersion("nightly", "0.86.1")).toBe(false);
  });
});

describe("readUpdates", () => {
  it("reports a newer pi release and the packages pi says are behind", async () => {
    const fetch = fetchStub({ ok: true, version: "99.0.0", note: "重大更新" });
    const packages = packageStub([
      { source: "npm:probe-pkg", displayName: "probe-pkg", type: "npm", scope: "user" },
    ]);

    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => packages },
    });

    expect([...fetch.calls].sort()).toEqual([PI_RELEASE_URL, APP_REGISTRY_URL]);
    expect(view.pi.current).toBe(VERSION);
    expect(view.pi.latest).toBe("99.0.0");
    expect(view.pi.available).toBe(true);
    expect(view.pi.note).toBe("重大更新");
    expect(view.pi.error).toBeNull();
    expect(view.pi.skipped).toBe(false);
    expect(view.extensions).toEqual([
      { source: "npm:probe-pkg", displayName: "probe-pkg", type: "npm", scope: "user" },
    ]);
    expect(view.extensionsError).toBeNull();
  });

  it("reports the running version as up to date", async () => {
    const fetch = fetchStub({ ok: true, version: VERSION });
    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => packageStub([]) },
    });

    expect(view.pi.available).toBe(false);
    expect(view.pi.latest).toBe(VERSION);
    expect(view.pi.error).toBeNull();
  });

  it("keeps 'could not check' apart from 'up to date'", async () => {
    const fetch = fetchStub(null, { fail: true });
    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => packageStub([]) },
    });

    expect(view.pi.available).toBe(false);
    expect(view.pi.latest).toBeNull();
    expect(view.pi.error).toContain("ECONNREFUSED");
  });

  it("reports a package-check failure without losing the pi answer", async () => {
    const fetch = fetchStub({ ok: true, version: "99.0.0" });
    const broken: PackageUpdateSource = {
      async checkForAvailableUpdates() {
        throw new Error("npm view exploded");
      },
      async update() {},
    };

    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => broken },
    });

    expect(view.pi.available).toBe(true);
    expect(view.extensions).toEqual([]);
    expect(view.extensionsError).toBe("npm view exploded");
  });

  it("skips the release check entirely when offline", async () => {
    process.env.PI_OFFLINE = "1";
    const fetch = fetchStub({ ok: true, version: "99.0.0" });
    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => packageStub([]) },
    });

    expect(fetch.calls).toEqual([]);
    expect(view.pi.skipped).toBe(true);
    expect(view.pi.error).toBeNull();
    // The project's own check respects the same two switches, so one offline
    // answer covers both rows instead of one of them phoning home anyway.
    expect(view.app.skipped).toBe(true);
    expect(view.app.error).toBeNull();
  });

  it("reuses a cached answer until it is forced", async () => {
    const fetch = fetchStub({ ok: true, version: "99.0.0" });
    const deps = { fetchImpl: fetch.impl, packageManager: () => packageStub([]) };

    await readUpdates(null, { deps });
    await readUpdates(null, { deps });
    expect(fetch.calls).toHaveLength(2);

    await readUpdates(null, { deps, force: true });
    expect(fetch.calls).toHaveLength(4);
  });
});

describe("updateExtension", () => {
  it("updates the named source and answers with a freshly resolved view", async () => {
    const fetch = fetchStub({ ok: true, version: "99.0.0" });
    const packages = packageStub([]);

    const view = await updateExtension(null, "npm:probe-pkg", {
      deps: { fetchImpl: fetch.impl, packageManager: () => packages },
    });

    expect(packages.updateCalls).toEqual(["npm:probe-pkg"]);
    expect(view.pi.available).toBe(true);
  });

  it("wraps a package-manager failure in the config error the route maps", async () => {
    const broken: PackageUpdateSource = {
      async checkForAvailableUpdates() {
        return [];
      },
      async update() {
        throw new Error("no such package");
      },
    };

    await expect(
      updateExtension(null, "npm:gone", { deps: { packageManager: () => broken } }),
    ).rejects.toBeInstanceOf(UpdatesConfigError);
  });
});

describe("this project's own release", () => {
  it("reports the newer version npm serves under the latest tag", async () => {
    const fetch = fetchStub({ ok: true, version: VERSION }, { app: { version: "99.0.0" } });
    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => packageStub([]) },
    });

    expect(view.app.packageName).toBe("pi-web-simple");
    // Read from this checkout's own package.json, so it is the real number.
    expect(view.app.current).toMatch(/^\d+\.\d+\.\d+/);
    expect(view.app.latest).toBe("99.0.0");
    expect(view.app.available).toBe(true);
    expect(view.app.error).toBeNull();
    expect(view.app.skipped).toBe(false);
    // The published CLI and the npx cache can both be moved by npm.
    expect(view.app.managed).toBe(true);
    expect(view.app.updateCommand).toContain("pi-web-simple");
  });

  it("keeps a registry with nothing to say apart from 'up to date'", async () => {
    const fetch = fetchStub({ ok: true, version: VERSION }, { app: {} });
    const view = await readUpdates(null, {
      deps: { fetchImpl: fetch.impl, packageManager: () => packageStub([]) },
    });

    expect(view.app.available).toBe(false);
    expect(view.app.latest).toBeNull();
    expect(view.app.error).toContain("pi-web-simple");
  });
});

describe("updateApp", () => {
  it("runs the install command, then answers from a freshly resolved check", async () => {
    const fetch = fetchStub({ ok: true, version: VERSION }, { app: { version: "99.0.0" } });
    const runs: string[][] = [];

    const view = await updateApp(null, {
      deps: {
        fetchImpl: fetch.impl,
        packageManager: () => packageStub([]),
        runCommand: async (argv) => {
          runs.push(argv);
        },
      },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.[0]).toBe("npm");
    expect(runs[0]).toContain("pi-web-simple@latest");
    // The cache was dropped, so this is the registry's answer again rather
    // than the one from before the command ran.
    expect(view.app.latest).toBe("99.0.0");
    expect(view.app.available).toBe(true);
  });

  it("wraps a failing command in the config error the route maps", async () => {
    await expect(
      updateApp(null, {
        deps: {
          runCommand: async () => {
            throw new Error("EACCES: permission denied");
          },
        },
      }),
    ).rejects.toBeInstanceOf(UpdatesConfigError);
  });

  it("refuses in the desktop shell, whose copy lives in an app bundle", async () => {
    vi.stubEnv("PI_WEB_SIMPLE_DESKTOP", "1");
    vi.resetModules();
    try {
      // Re-imported because the switch is read once, at module load.
      const fresh = await import("./updates.ts");
      await expect(fresh.updateApp(null)).rejects.toBeInstanceOf(fresh.UpdatesConfigError);
      fresh.clearUpdateCache();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
