import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.PI_WEB_SIMPLE_PORT ?? "4319";
const API_TARGET = `http://127.0.0.1:${API_PORT}`;

/**
 * 这个前端自身的版本，烘进产物里而不是运行时去问服务端。
 *
 * 版本号只有仓库根 `package.json` 一处来源——桌面壳的 `app/package.json`
 * 也是从同一份里抄的（见 desktop/scripts/prepare-app.mjs），所以三个发行
 * 形态（CLI、浏览器、桌面）报出来的是同一个数。它是构建期的常量，不是
 * 一件要问上游才知道的事，因此不走 `/api/updates`：那个接口带着网络检查
 * 和缓存，而这里只需要一个字符串。
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
