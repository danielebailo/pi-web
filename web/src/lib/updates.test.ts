import { describe, expect, it } from "vitest";
import { translator } from "./i18n/index.ts";

// These assertions pin the Chinese wording, so the translator is passed in
// rather than resolved from whatever locale the test host happens to have.
const zh = translator("zh-CN");
const versionStatus = (notice: VersionNotice | null): string => versionStatusOf(notice, zh);
const extensionUpdateStatus = (view: UpdatesView | null): string => extensionUpdateStatusOf(view, zh);
import type { AppVersionInfo, ExtensionUpdate, PiVersionInfo, UpdatesView } from "./types.ts";
import {
  extensionUpdateCount,
  extensionUpdateStatus as extensionUpdateStatusOf,
  hasAnyUpdate,
  updateForSource,
  versionStatus as versionStatusOf,
  type VersionNotice,
} from "./updates.ts";

function piInfo(patch: Partial<PiVersionInfo> = {}): PiVersionInfo {
  return {
    current: "0.86.1",
    latest: null,
    available: false,
    note: null,
    packageName: "@earendil-works/pi-coding-agent",
    updateCommand: "pnpm update @earendil-works/pi-coding-agent",
    error: null,
    skipped: false,
    ...patch,
  };
}

function appInfo(patch: Partial<AppVersionInfo> = {}): AppVersionInfo {
  return {
    current: "0.9.0",
    latest: null,
    available: false,
    packageName: "pi-web-simple",
    updateCommand: "npm install -g pi-web-simple@latest",
    managed: true,
    error: null,
    skipped: false,
    ...patch,
  };
}

function update(source: string): ExtensionUpdate {
  return { source, displayName: source, type: "npm", scope: "user" };
}

function view(patch: Partial<UpdatesView> = {}): UpdatesView {
  return {
    pi: piInfo(),
    app: appInfo(),
    extensions: [],
    extensionsError: null,
    checkedAt: 0,
    ...patch,
  };
}

describe("updateForSource", () => {
  it("finds the update row that shares a package's source string", () => {
    const payload = view({
      extensions: [update("npm:probe-pkg"), update("npm:other")],
    });

    expect(updateForSource(payload, "npm:other")?.source).toBe("npm:other");
    expect(updateForSource(payload, "npm:missing")).toBeNull();
    expect(updateForSource(null, "npm:probe-pkg")).toBeNull();
  });
});

describe("hasAnyUpdate", () => {
  it("is true for a newer pi, a newer project, a newer package, or any mix", () => {
    expect(hasAnyUpdate(null)).toBe(false);
    expect(hasAnyUpdate(view())).toBe(false);
    expect(hasAnyUpdate(view({ pi: piInfo({ available: true, latest: "0.87.0" }) }))).toBe(true);
    expect(hasAnyUpdate(view({ app: appInfo({ available: true, latest: "0.10.0" }) }))).toBe(true);
    expect(hasAnyUpdate(view({ extensions: [update("npm:pkg")] }))).toBe(true);
  });
});

describe("extensionUpdateCount", () => {
  it("counts the reported packages, and is zero before an answer arrives", () => {
    expect(extensionUpdateCount(null)).toBe(0);
    expect(extensionUpdateCount(view())).toBe(0);
    expect(extensionUpdateCount(view({ extensions: [update("a"), update("b")] }))).toBe(2);
  });
});

describe("versionStatus", () => {
  it("does not claim 'up to date' before an answer or after a failed check", () => {
    expect(versionStatus(null)).toBe("正在检查…");
    expect(versionStatus(piInfo({ error: "fetch failed" }))).toBe("无法检查更新");
    expect(versionStatus(piInfo({ skipped: true }))).toBe("已跳过检查");
  });

  it("names the newer version when there is one", () => {
    expect(versionStatus(piInfo({ available: true, latest: "0.87.0" }))).toBe("有新版本 0.87.0");
    expect(versionStatus(piInfo({ available: true, latest: null }))).toBe("有新版本可用");
  });

  it("reports 'up to date' only for a completed check with nothing newer", () => {
    expect(versionStatus(piInfo({ latest: "0.86.1" }))).toBe("已是最新");
  });

  it("reads the same for the project's own notice as for pi's", () => {
    expect(versionStatus(appInfo())).toBe("已是最新");
    expect(versionStatus(appInfo({ available: true, latest: "0.10.0" }))).toBe("有新版本 0.10.0");
    expect(versionStatus(appInfo({ skipped: true }))).toBe("已跳过检查");
  });
});

describe("extensionUpdateStatus", () => {
  it("distinguishes no answer, a broken check, and an empty result", () => {
    expect(extensionUpdateStatus(null)).toBe("正在检查…");
    expect(extensionUpdateStatus(view({ extensionsError: "npm view exploded" }))).toBe(
      "无法检查更新",
    );
    expect(extensionUpdateStatus(view())).toBe("已是最新");
  });

  it("counts the packages that are behind", () => {
    expect(extensionUpdateStatus(view({ extensions: [update("npm:a")] }))).toBe("1 个插件可更新");
  });
});
