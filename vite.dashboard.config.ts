import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { injectActionToken } from "./scripts/lib/action-token";
import { DASHBOARD_OUT_DIR } from "./scripts/lib/dashboard-build";

/**
 * The telemetry dashboard's own Vite app (ADR 0117, PRD #3148 S0).
 *
 * Separate from `vite.config.ts` because it shares nothing with the game
 * client but the design system: no Convex, no router, no card catalogue, no
 * React Compiler pass over the engine. What it DOES share is `src/` — `@`
 * resolves there so the shadcn primitives S1 adds are importable rather than
 * copied.
 *
 * TWO MODES, one command (`bun run telemetry:dash [--dev]`):
 *
 * - **build** — `base: "/assets/"`, content-hashed filenames, a manifest.
 *   `telemetry-serve.ts` reads that manifest and serves exactly the files it
 *   names (see `scripts/lib/dashboard-build.ts`).
 * - **dev** — this dev server is the one the operator opens, and `/api/*` is
 *   proxied to the Bun server `telemetry-serve.ts --dev` started on an
 *   ephemeral port. So the page hot-reloads while every route still answers
 *   from the real server. `base` is `/` there: the built page's `/assets/`
 *   prefix is a SERVING concern, and forcing it in dev would only move the
 *   dev URL somewhere nobody types.
 */
export default defineConfig(({ command }) => ({
    root: path.resolve(__dirname, "dashboard"),
    base: command === "build" ? "/assets/" : "/",
    resolve: {
        alias: [
            { find: "~", replacement: path.resolve(__dirname, "src") },
            { find: "@", replacement: path.resolve(__dirname, "src") },
        ],
    },
    build: {
        outDir: path.resolve(__dirname, DASHBOARD_OUT_DIR),
        emptyOutDir: true,
        // The serving allow-list IS this file. Without it the server has no
        // way to know which hashed names the build produced.
        manifest: true,
        // Flat: with the default `assets` subdirectory every manifest name
        // would be `assets/main-<hash>.js` and the URL `/assets/assets/…`.
        // Flattening keeps the served path one segment, which keeps the
        // lookup key equal to the manifest name.
        assetsDir: "",
        target: "es2023",
    },
    server: {
        // `main.tsx` imports `../scripts/dashboard/*`, which is outside the
        // Vite root — the dev server must be allowed to read it.
        fs: { allow: [path.resolve(__dirname)] },
        proxy: {
            "/api": {
                target: `http://127.0.0.1:${process.env.TELEMETRY_DEV_API_PORT ?? "5175"}`,
                changeOrigin: false,
            },
        },
    },
    plugins: [react(), devActionToken()],
}));

/**
 * The per-boot action token, in dev (#2628).
 *
 * In production the token rides into the page in `telemetry-serve.ts`'s
 * response, and never anywhere else. In dev the document is served by THIS
 * process, so the token has to reach it another way — and the way is
 * deliberately NOT an HTTP route: an `/api/action-token` endpoint would be a
 * second, permanent way to obtain a privileged credential, live in production
 * too, and it would exist purely for a developer convenience.
 *
 * Instead `telemetry-serve.ts --dev` spawns this process and passes its own
 * boot token in the child's environment. Same user, same machine, same trust
 * domain, and the token still never touches disk or a log.
 *
 * Absent the variable (someone running `vite --config vite.dashboard.config.ts`
 * by hand) the meta tag is omitted entirely rather than emitted empty: the
 * action buttons then 401, which is the honest outcome — an empty token
 * authenticates nothing, and `telemetry-serve.test.ts` pins that.
 */
function devActionToken(): Plugin {
    return {
        name: "tolaria:dev-action-token",
        apply: "serve",
        transformIndexHtml(html) {
            const token = process.env.TELEMETRY_DEV_ACTION_TOKEN;
            return token ? injectActionToken(html, token) : html;
        },
    };
}
