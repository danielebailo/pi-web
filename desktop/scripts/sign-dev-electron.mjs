#!/usr/bin/env node
/**
 * 开发模式下给 Electron 自己重签名（macOS）。
 *
 * 为什么需要：Electron 42 起 macOS 的通知走 `UNNotification`，而它要求应用有
 * **真正的签名**才肯投递。`node_modules` 里那份 `Electron.app` 只有链接器签名
 * （`flags=0x20002(adhoc,linker-signed)`），于是 `Notification#show()` 会静默
 * 走 `failed` 分支——`notification.isSupported()` 照样返回 `true`，从界面上看
 * 就是「什么都没发生」。
 *
 * ad-hoc 重签（`--sign -`）把它换成 `flags=0x2(adhoc)`，通知随即恢复。这不会
 * 改变 Gatekeeper 的判定——本项目本来就没有证书，该手动放行还是手动放行。
 *
 * 其它平台直接跳过：Windows 的通知没有这道签名要求，Linux 走的是另一套机制，
 * 都不该因为一个 macOS 的坑被拖慢。
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform !== "darwin") process.exit(0);

const electronDir = dirname(createRequire(import.meta.url).resolve("electron/package.json"));
const appBundle = join(electronDir, "dist", "Electron.app");

/** 已经是 `(adhoc)` 而不是 `(adhoc,linker-signed)`，说明上次已经签过。 */
function alreadyResigned() {
  // codesign 把自己的报告写到 stderr，不是 stdout。
  const probe = spawnSync("codesign", ["-dv", "--verbose=4", appBundle], { encoding: "utf8" });
  return /\(adhoc\)/.test(probe.stderr ?? "");
}

if (alreadyResigned()) process.exit(0);

const signed = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appBundle], {
  stdio: "ignore",
});
if (signed.status !== 0) {
  // 签不上不该拦住开发：没有通知总比起不来好，而且打包版由 afterPack 单独负责。
  console.warn("· 开发用的 Electron 重签名失败，macOS 通知可能不会显示（打包版不受影响）。");
  process.exit(0);
}

console.log("· 已给开发用的 Electron 重签名（macOS 要签名才投递通知）。");
