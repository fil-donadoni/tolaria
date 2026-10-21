/**
 * The cockpit's server (issue #5652, ADR 0156 Amendment I § The dashboard is
 * simplified, not removed).
 *
 * Serves the built page (ADR 0117) and ONE read, `GET /api/cockpit`: the
 * reading `bun run cockpit` last wrote (`scripts/lib/cockpit.ts`), read from
 * disk on every request — so a second `bun run cockpit` beside a running
 * server refreshes the page without a restart. Nothing here shells out,
 * opens the telemetry store or acts: the Actions tab is the "now", and every
 * number is gathered by `scripts/cockpit.ts` before the page asks.
 *
 * Usage: bun run telemetry:dash [--port 5174] [--dev] — `bun run cockpit`
 * starts it for you.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
    DASHBOARD_BUILD_COMMAND,
    DASHBOARD_OUT_DIR,
    readDashboardBuild,
} from "./lib/dashboard-build";
import type { DashboardBuild } from "./lib/dashboard-build";
import { COCKPIT_COMMAND, cockpitReadingPath } from "./lib/cockpit";

/** The checkout this file belongs to: it serves its own build, so a cockpit
 *  started from a worktree shows that worktree's page. */
const ROOT = join(import.meta.dirname, "..");
/** Where `vite.dashboard.config.ts` writes the built dashboard (ADR 0117).
 *  Nothing is served from outside it. */
const DASHBOARD_BUILD_DIR = join(ROOT, DASHBOARD_OUT_DIR);

/** The well-known port `bun run cockpit` opens. */
export const DEFAULT_PORT = 5174;

/**
 * The dashboard's build, read ONCE per process (ADR 0117).
 *
 * `undefined` means "not looked at yet"; `null` means "looked, and there is no
 * build". Both are distinct from a `DashboardBuild`, and the difference is why
 * this is not a plain `??=`: a missing build must not be re-`stat`ed on every
 * request, and it must keep answering 503 until the operator rebuilds and
 * restarts — the process reads the manifest at boot by design, so the set of
 * served names cannot drift under a running server.
 */
let dashboardBuildCache: DashboardBuild | null | undefined;
function loadDashboardBuild(): DashboardBuild | null {
    if (dashboardBuildCache === undefined) {
        dashboardBuildCache = readDashboardBuild(DASHBOARD_BUILD_DIR);
    }
    return dashboardBuildCache;
}

/** The one answer for every dashboard route when there is no build: which
 *  command makes one. Never a blank page, never a stack trace. */
function noDashboardBuildResponse(): Response {
    return new Response(
        `the telemetry dashboard is not built — run: ${DASHBOARD_BUILD_COMMAND}`,
        {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
        }
    );
}

/** Everything under this prefix is an allow-list lookup and nothing else. */
const ASSET_PREFIX = "/assets/";

/** The cockpit reading's route — the page's only read. */
export const COCKPIT_ROUTE = "/api/cockpit";

export interface TelemetryDeps {
    /**
     * Reads one file off disk. Injected because the `node` vitest project
     * has no `Bun.file`, so an asset route built on it could not be tested
     * at all — and the allow-list is precisely the part that must be. The
     * injection also lets the test assert WHICH path the route asked for,
     * which is how "the request string never reaches the filesystem" is
     * proven rather than asserted.
     */
    readAsset: (absolutePath: string) => Promise<string>;
    /**
     * Reads one BUILT asset as bytes. Separate from `readAsset` because that
     * one decodes UTF-8, which is right for the document and silently wrong
     * for everything a bundle can contain that is not text — a font, an icon,
     * an image: the server would hand out mojibake under a correct
     * `Content-Type`.
     */
    readAssetBytes: (absolutePath: string) => Promise<Uint8Array>;
    /**
     * The dashboard's build manifest, or `null` when it has not been built
     * (ADR 0117). Injected for the same reason `readAsset` is: a test cannot
     * run a Vite build to obtain one.
     */
    dashboardBuild: DashboardBuild | null;
    /** The last cockpit reading as JSON text, or `null` when none was
     *  written yet. */
    readCockpit: () => Promise<string | null>;
}

async function readCockpitFile(): Promise<string | null> {
    try {
        return await readFile(cockpitReadingPath(), "utf8");
    } catch {
        return null;
    }
}

const defaultDeps: TelemetryDeps = {
    readAsset: (absolutePath) => readFile(absolutePath, "utf8"),
    readAssetBytes: (absolutePath) => readFile(absolutePath),
    // A getter, so importing this module reads no manifest (#2623).
    get dashboardBuild() {
        return loadDashboardBuild();
    },
    readCockpit: readCockpitFile,
};

/**
 * The whole route table, extracted from the `Bun.serve` listener (#2623) so
 * every route is callable with an in-memory `Request` — no socket, no port.
 * `startServer` below is the only thing that binds it to a real port.
 */
export async function handleRequest(
    req: Request,
    deps: Partial<TelemetryDeps> = {}
): Promise<Response> {
    // `Partial`, so a test that only cares about one seam passes one key.
    const { readAsset, readAssetBytes, dashboardBuild, readCockpit } = {
        ...defaultDeps,
        ...deps,
    };
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed", {
            status: 405,
            headers: { allow: "GET, HEAD" },
        });
    }
    if (url.pathname === COCKPIT_ROUTE) {
        // Served as written: `scripts/cockpit.ts` wrote it with
        // `JSON.stringify`, and the page validates its version.
        const text = await readCockpit();
        if (text === null)
            return Response.json(
                { error: `no cockpit reading yet — run: ${COCKPIT_COMMAND}` },
                { status: 503 }
            );
        return new Response(text, {
            headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!dashboardBuild) return noDashboardBuildResponse();
        // The BUILD's `index.html` (ADR 0117): it already carries the hashed
        // asset URLs.
        return new Response(await readAsset(dashboardBuild.htmlPath), {
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    }
    if (url.pathname.startsWith(ASSET_PREFIX)) {
        if (!dashboardBuild) return noDashboardBuildResponse();
        // The remainder of the path is used as a Map KEY and for nothing
        // else. There is no `join` with it, no normalisation, no
        // `startsWith` containment check — a name the build did not write
        // (including every spelling of a traversal) simply misses and 404s.
        // See `scripts/lib/dashboard-build.ts`.
        const asset = dashboardBuild.assets.get(
            url.pathname.slice(ASSET_PREFIX.length)
        );
        if (!asset) return new Response("not found", { status: 404 });
        // BYTES, never a decoded string — see `readAssetBytes`.
        return new Response(await readAssetBytes(asset.path), {
            headers: { "content-type": asset.type },
        });
    }
    return new Response("not found", { status: 404 });
}

/**
 * `TELEMETRY_SERVE_PORT` exists only so the bootstrap-guard test can pick a
 * port that is guaranteed not to collide with a real cockpit an operator may
 * already have open on the well-known default (#2623).
 */
export function resolvePort(argv: readonly string[] = process.argv): number {
    const portArg = argv.indexOf("--port");
    if (portArg > -1) return Number(argv[portArg + 1]);
    const envPort = process.env.TELEMETRY_SERVE_PORT;
    return envPort ? Number(envPort) : DEFAULT_PORT;
}

/**
 * Binds `handleRequest` to a loopback socket. Its callers are the
 * `import.meta.main` guard below and `scripts/cockpit.ts` — so importing this
 * module (as the test file does) never opens a port (#2623). Bun has no
 * `require.main === module`; `import.meta.main` is the idiomatic equivalent
 * and reads `false` for a module reached via `import`.
 */
export function startServer(
    port: number = resolvePort(),
    { announce = true }: { announce?: boolean } = {}
) {
    const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: (req) => handleRequest(req),
    });
    if (announce) {
        console.log(`cockpit → http://127.0.0.1:${server.port}`);
    }
    return server;
}

/**
 * `--dev` (ADR 0117): the page comes from Vite, `/api/cockpit` still comes
 * from this server, on an ephemeral port Vite proxies to. Vite binds the
 * well-known port, so `bun run telemetry:dash --dev` still means "open
 * http://127.0.0.1:5174".
 */
function startDevServer(): void {
    const pagePort = resolvePort();
    const api = startServer(0, { announce: false });
    const vite = Bun.spawn(
        [
            "bunx",
            "vite",
            "--config",
            "vite.dashboard.config.ts",
            "--port",
            String(pagePort),
            "--strictPort",
        ],
        {
            cwd: ROOT,
            stdio: ["inherit", "inherit", "inherit"],
            env: {
                ...process.env,
                TELEMETRY_DEV_API_PORT: String(api.port ?? 0),
            },
        }
    );
    // The API server exists only to answer the dev page: when Vite is gone,
    // so is the page.
    void vite.exited.then((code) => {
        api.stop(true);
        process.exit(code ?? 0);
    });
}

if (import.meta.main) {
    if (process.argv.includes("--dev")) startDevServer();
    else startServer();
}
