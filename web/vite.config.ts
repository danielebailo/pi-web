import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.PI_WEB_SIMPLE_PORT ?? "4319";
const API_TARGET = `http://127.0.0.1:${API_PORT}`;

/**
 * 这个前端自身的版本，烘进产物里作兜底。
 *
 * 版本号只有仓库根 `package.json` 一处来源——桌面壳的 `app/package.json`
 * 也是从同一份里抄的（见 desktop/scripts/prepare-app.mjs），所以三个发行
 * 形态（CLI、浏览器、桌面）报出来的是同一个数。「关于」里的项目版本行显示的
 * 是服务端现读的那份（`/api/updates` 的 `app.current`），因为只有服务端那份
 * 能拿去和 npm 上的版本比较、并在更新完之后重新读一次；这个常量只在那一次
 * 读失败时顶上——同一份文件的两种读法，只在那一种情况下才会不一致。
 */
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    // Bind IPv4 explicitly: `localhost` can resolve to ::1 only, which makes
    // the dev server unreachable from tools that dial 127.0.0.1.
    host: "127.0.0.1",
    port: 5319,
    strictPort: true,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: false,
        // SSE must not be buffered by the proxy.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              delete proxyRes.headers["content-encoding"];
            }
          });
        },
      },
    },
  },
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
});
