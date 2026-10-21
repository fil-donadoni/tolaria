import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
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
 * TWO MODES (`bun run cockpit` builds when a source changed; by hand,
 * `bun run telemetry:dash:build` and `bun run telemetry:dash --dev`):
 *
 * - **build** — `base: "/assets/"`, content-hashed filenames, a manifest.
 *   `telemetry-serve.ts` reads that manifest and serves exactly the files it
 *   names (see `scripts/lib/dashboard-build.ts`).
 * - **dev** — this dev server is the one the operator opens, and `/api/*` is
 *   proxied to the Bun server `telemetry-serve.ts --dev` started on an
 *   ephemeral port. So the page hot-reloads while `/api/cockpit` still
 *   answers from the real server. `base` is `/` there: the built page's `/assets/`
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
        // The app's root is `dashboard/`, but it imports the shadcn primitives
        // out of `src/` (the `@` alias above) and its Tailwind entry `@source`s
        // that directory too — both outside the Vite root, so the dev server
        // must be allowed to read them.
        fs: { allow: [path.resolve(__dirname)] },
        proxy: {
            "/api": {
                target: `http://127.0.0.1:${process.env.TELEMETRY_DEV_API_PORT ?? "5175"}`,
                changeOrigin: false,
            },
        },
    },
    plugins: [tailwindcss(), react()],
}));
