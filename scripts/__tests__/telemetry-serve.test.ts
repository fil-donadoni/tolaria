import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "node:net";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DashboardBuild } from "../lib/dashboard-build";

/**
 * `telemetry-serve.ts` (#2623; the cockpit's server since issue #5652) — the
 * request handler extracted from the `Bun.serve` listener so every route is
 * callable with an in-memory `Request`. This suite runs in a node vitest project (confirmed by
 * hand: the plain `Bun` global and `bun:sqlite` are BOTH unavailable here —
 * `bunx vitest run --project node-tooling`, `check-lane.ts`'s own
 * command, genuinely executes under Node, not Bun), so nothing here may
 * reference `Bun.*` — `startServer()`'s own `Bun.serve` call is exercised
 * only by the manual check in the PR description, never by this file.
 *
 * Every `import()` below is deliberate rather than hoisted to the top of
 * the file: it is what makes `import.meta.main` read `false` for the
 * target module in the first place (true only for the process's
 * entry-point module, never one reached via `import`) — exactly the
 * condition `startServer()` is gated on in production. If that guard were
 * ever weakened (the `if (import.meta.main)` check dropped, or
 * `startServer()` called unconditionally at module scope), the very first
 * `import` in this file would eagerly try to bind a port before any test
 * body ran — the "silent real port under the parallel gate" failure mode
 * this issue exists to prevent (and, under this specific Node runtime,
 * `startServer()`'s own `Bun.serve` call would throw `Bun is not defined`
 * at import time — an even louder failure). No `vi.mock` / `vi.spyOn` /
 * fake timers here — the `node` vitest project runs with `isolate: false`
 * on the promise that these files hold no such state to leak between them.
 */

/** Node's `net`, not `Bun.serve` — portable across whichever runtime this
 *  project ends up running the `node` vitest project under, and enough to
 *  prove a TCP port is/isn't bound regardless of who bound it. */
function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.once("error", () => resolve(false));
        probe.listen(port, "127.0.0.1", () => {
            probe.close(() => resolve(true));
        });
    });
}

/** An OS-assigned free port, read back from a bind-then-close round trip —
 *  never a fixed constant (#2623 review round 1, finding 2): a hardcoded
 *  port collides between two concurrent light-tier runs on the same
 *  machine, reading as a false guard failure rather than a real one. */
function getEphemeralPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            if (address && typeof address === "object") {
                const port = address.port;
                probe.close(() => resolve(port));
            } else {
                probe.close(() =>
                    reject(new Error("could not determine ephemeral port"))
                );
            }
        });
    });
}

describe("telemetry-serve — bootstrap guard (#2623)", () => {
    it("importing the module opens no port — not even the module's own resolved default", async () => {
        // Deliberately not the real default (5174) either: this machine
        // can have a live `bun run cockpit` an operator is watching
        // (observed running here during development), and probing the
        // literal well-known port would collide with a legitimate,
        // unrelated process rather than with a regression in THIS module.
        // `TELEMETRY_SERVE_PORT` (read by `resolvePort()`, only reachable
        // through `startServer()`) redirects what a regressed guard would
        // bind to this ephemeral port instead — set before the FIRST
        // import of the module in this worker (module top-level code,
        // including a broken guard, runs exactly once, at that import).
        const testPort = await getEphemeralPort();
        const prevPort = process.env.TELEMETRY_SERVE_PORT;
        process.env.TELEMETRY_SERVE_PORT = String(testPort);
        try {
            await import("../telemetry-serve");
            // If the import above had wrongly called `startServer()` (a
            // dropped/weakened `import.meta.main` guard), `testPort` is
            // already bound and this resolves `false`.
            expect(await isPortFree(testPort)).toBe(true);
        } finally {
            if (prevPort === undefined) delete process.env.TELEMETRY_SERVE_PORT;
            else process.env.TELEMETRY_SERVE_PORT = prevPort;
        }
    });
});

const READING = JSON.stringify({ version: 1, readAt: "2026-10-21T12:00:00Z" });

describe("telemetry-serve — handleRequest routes (#2623, issue #5652)", () => {
    it("/api/cockpit serves the last reading as written, never cached", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request("http://127.0.0.1/api/cockpit"),
            { readCockpit: async () => READING }
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(
            "application/json; charset=utf-8"
        );
        expect(res.headers.get("cache-control")).toBe("no-store");
        await expect(res.text()).resolves.toBe(READING);
    });

    it("/api/cockpit with no reading yet 503s with the command that makes one", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request("http://127.0.0.1/api/cockpit"),
            { readCockpit: async () => null }
        );
        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toEqual({
            error: "no cockpit reading yet — run: bun run cockpit",
        });
    });

    it("a missing build takes no route with it — /api/cockpit still answers", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request("http://127.0.0.1/api/cockpit"),
            { dashboardBuild: null, readCockpit: async () => READING }
        );
        expect(res.status).toBe(200);
    });

    it.each([
        "/api/loop-status",
        "/api/action",
        "/api/activity",
        "/api/live",
        "/api/tail",
        "/api/meta",
        "/api/sessions",
        "/api/issues",
        "/api/families",
        "/api/runs",
        "/api/q",
    ])("the retired route %s is gone — 404", async (pathname) => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request(`http://127.0.0.1${pathname}`),
            { readCockpit: async () => READING }
        );
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toBe("not found");
    });

    it("reads only: anything but GET or HEAD is refused before any route", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        let reads = 0;
        const res = await handleRequest(
            new Request("http://127.0.0.1/api/cockpit", {
                method: "POST",
                body: "{}",
            }),
            {
                readCockpit: async () => {
                    reads += 1;
                    return READING;
                },
            }
        );
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD");
        expect(reads).toBe(0);
    });
});

/** The React app (ADR 0117) — `dashboard/` at the repo root, one level above
 *  `scripts/`. */
const REPO_REACT_DIR = join(import.meta.dirname, "..", "..", "dashboard");

/**
 * A build, as `readDashboardBuild` would return one — hashed names and all.
 *
 * Injected rather than produced: the `node` vitest project cannot run a Vite
 * build (and would not want to pay for one), and the property under test is
 * the LOOKUP, which is independent of who wrote the manifest. `BUILD_DIR` is
 * a path that exists nowhere and every read seam is injected below, so no
 * assertion in this describe depends on a file existing. (`handleRequest`
 * still probes the real output directory ONCE per process for its default
 * `dashboardBuild`; every case here overrides it, so that probe never
 * decides an outcome.)
 */
const BUILD_DIR = join("/nonexistent", "dashboard", "dist");
const builtAssets = ["index-BfYWQ-gq.css", "index-iaOdGxez.js"];
const fakeBuild = (): DashboardBuild => ({
    assets: new Map(
        builtAssets.map((name) => [
            name,
            {
                path: join(BUILD_DIR, name),
                type: name.endsWith(".css")
                    ? "text/css; charset=utf-8"
                    : "text/javascript; charset=utf-8",
            },
        ])
    ),
    htmlPath: join(BUILD_DIR, "index.html"),
});

describe("telemetry-serve — dashboard asset serving (ADR 0117)", () => {
    it("serves a built asset, and asks the filesystem for the MANIFEST's path — never for the request's text", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const asked: string[] = [];
        const res = await handleRequest(
            new Request("http://127.0.0.1/assets/index-iaOdGxez.js"),
            {
                dashboardBuild: fakeBuild(),
                readAssetBytes: async (p) => {
                    asked.push(p);
                    return new TextEncoder().encode("// served");
                },
            }
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(
            "text/javascript; charset=utf-8"
        );
        await expect(res.text()).resolves.toBe("// served");
        expect(asked).toEqual([join(BUILD_DIR, "index-iaOdGxez.js")]);
    });

    it("serves the stylesheet as CSS", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request("http://127.0.0.1/assets/index-BfYWQ-gq.css"),
            {
                dashboardBuild: fakeBuild(),
                readAssetBytes: async () => new TextEncoder().encode("body{}"),
            }
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    });

    /**
     * PROOF-OF-FAILURE (recorded in the PR): replacing the `Map.get` lookup in
     * `handleRequest` with the naive `readAsset(join(BUILD_DIR, name))` reds
     * every case below — the traversals resolve and return file contents
     * instead of 404, and `evil.js` reaches the filesystem. Reverted after
     * watching it fail.
     *
     * The names changed with the bundler (ADR 0117); the PROPERTY did not.
     * Each row is a DIFFERENT way of spelling "not a name the build wrote",
     * because the failure mode of a sanitiser is that it handles the spelling
     * its author thought of. An exact-match lookup has no spellings to handle:
     * the request text is a Map key, so every one of these is simply absent.
     */
    it.each([
        ["a name that is not in the manifest", "/assets/evil.js"],
        ["the pre-build name of a real module", "/assets/main.js"],
        ["a plain traversal", "/assets/../telemetry-serve.ts"],
        ["a deep traversal", "/assets/../../package.json"],
        ["a percent-encoded traversal", "/assets/%2e%2e%2ftelemetry-serve.ts"],
        ["a double-encoded traversal", "/assets/%252e%252e%252fpackage.json"],
        ["a backslash traversal", "/assets/..\\telemetry-serve.ts"],
        ["an absolute path", "/assets//etc/passwd"],
        [
            "a nested path under a built name",
            "/assets/index-iaOdGxez.js/../../.env",
        ],
        ["a prototype key", "/assets/__proto__"],
        ["a constructor key", "/assets/constructor"],
        ["the empty name", "/assets/"],
        ["the built document itself", "/assets/index.html"],
        [
            "a built name with a null-byte suffix",
            "/assets/index-iaOdGxez.js%00.txt",
        ],
    ])("refuses %s", async (_label, pathname) => {
        const { handleRequest } = await import("../telemetry-serve");
        let reads = 0;
        const res = await handleRequest(
            new Request(`http://127.0.0.1${pathname}`),
            {
                dashboardBuild: fakeBuild(),
                readAsset: async () => {
                    reads += 1;
                    return "LEAKED";
                },
                readAssetBytes: async () => {
                    reads += 1;
                    return new TextEncoder().encode("LEAKED");
                },
            }
        );
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toBe("not found");
        // The stronger claim: refused BY CONSTRUCTION. Nothing was read.
        expect(reads).toBe(0);
    });

    it("serves a built asset as BYTES — a font or an icon is not UTF-8 text", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        // Four bytes that are not valid UTF-8. Decoded and re-encoded they
        // come back as U+FFFD replacement characters, so this asserts the
        // route never took that path — the failure mode is a font that loads
        // as garbage under a perfectly correct Content-Type.
        const bytes = new Uint8Array([0x00, 0x80, 0xfe, 0xff]);
        const build = fakeBuild();
        const assets = new Map(build.assets);
        assets.set("logo-abc123.woff2", {
            path: join(BUILD_DIR, "logo-abc123.woff2"),
            type: "font/woff2",
        });
        const res = await handleRequest(
            new Request("http://127.0.0.1/assets/logo-abc123.woff2"),
            {
                dashboardBuild: { ...build, assets },
                readAssetBytes: async () => bytes,
            }
        );
        expect(res.headers.get("content-type")).toBe("font/woff2");
        const served = new Uint8Array(await res.arrayBuffer());
        expect([...served]).toEqual([...bytes]);
    });

    it.each(["/", "/index.html", "/assets/index-iaOdGxez.js"])(
        "%s 503s with the build command when there is no build — never a blank page",
        async (pathname) => {
            const { handleRequest } = await import("../telemetry-serve");
            let reads = 0;
            const res = await handleRequest(
                new Request(`http://127.0.0.1${pathname}`),
                {
                    dashboardBuild: null,
                    readAsset: async () => {
                        reads += 1;
                        return "LEAKED";
                    },
                    readAssetBytes: async () => {
                        reads += 1;
                        return new TextEncoder().encode("LEAKED");
                    },
                }
            );
            expect(res.status).toBe(503);
            await expect(res.text()).resolves.toContain(
                "bun run telemetry:dash:build"
            );
            expect(reads).toBe(0);
        }
    );

    it("the Vite entry is a shell: one #root, one module script, no inline behaviour or styling", () => {
        const shell = readFileSync(join(REPO_REACT_DIR, "index.html"), "utf8");
        expect(shell).toContain('<div id="root"></div>');
        expect(shell).toContain('<script type="module" src="/main.tsx">');
        expect(shell).not.toContain("<style");
        expect(shell).not.toMatch(/<script(?![^>]*\bsrc=)/);
        // The hashed asset tags are the BUILD's job, so the source document
        // must name none of them — a hand-written `/assets/…` here would be a
        // path that rots on the next content change.
        expect(shell).not.toContain("/assets/");
    });
});

/**
 * `readDashboardBuild` — the map's construction (ADR 0117).
 *
 * The route tests above inject a build; these are what say the real reader
 * produces one with the same shape, from bytes a Vite build actually writes.
 */
describe("readDashboardBuild — the manifest IS the allow-list (ADR 0117)", () => {
    const dirs: string[] = [];
    const outDir = (manifest: unknown, html = true): string => {
        const dir = mkdtempSync(join(tmpdir(), "dashboard-build-"));
        dirs.push(dir);
        if (manifest !== undefined) {
            mkdirSync(join(dir, ".vite"), { recursive: true });
            writeFileSync(
                join(dir, ".vite", "manifest.json"),
                typeof manifest === "string"
                    ? manifest
                    : JSON.stringify(manifest)
            );
        }
        if (html) writeFileSync(join(dir, "index.html"), "<html></html>");
        return dir;
    };
    afterAll(() => {
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });

    /** The real shape Vite 8 writes for this app, trimmed to the keys the
     *  reader looks at — captured from an actual `telemetry:dash:build`. */
    const REAL_MANIFEST = {
        "dashboard/main.tsx": { file: "main-CZP9F4c_.js" },
        "_tooltip-Bm5uVsJF.js": { file: "tooltip-Bm5uVsJF.js" },
        "index.html": {
            file: "index-iaOdGxez.js",
            css: ["index-BfYWQ-gq.css"],
            isEntry: true,
        },
    };

    it("names every file the manifest names — entry chunk, split chunks and css alike", async () => {
        const { readDashboardBuild } = await import("../lib/dashboard-build");
        const dir = outDir(REAL_MANIFEST);
        const build = readDashboardBuild(dir)!;
        expect([...build.assets.keys()].sort()).toEqual([
            "index-BfYWQ-gq.css",
            "index-iaOdGxez.js",
            "main-CZP9F4c_.js",
            "tooltip-Bm5uVsJF.js",
        ]);
        // Every path is built HERE, from the manifest's name.
        expect(build.assets.get("index-iaOdGxez.js")!.path).toBe(
            join(dir, "index-iaOdGxez.js")
        );
        expect(build.assets.get("index-BfYWQ-gq.css")!.type).toBe(
            "text/css; charset=utf-8"
        );
        expect(build.htmlPath).toBe(join(dir, "index.html"));
    });

    it("keeps the document out of the asset map — /assets/index.html can never hand out an un-tokenised shell", async () => {
        const { readDashboardBuild } = await import("../lib/dashboard-build");
        const build = readDashboardBuild(
            outDir({ "index.html": { file: "index.html", isEntry: true } })
        )!;
        expect(build.assets.has("index.html")).toBe(false);
    });

    it.each([
        ["a traversal", "../../.env"],
        ["a nested traversal", "chunks/../../.env"],
        ["an absolute path", "/etc/passwd"],
    ])(
        "refuses a manifest name that leaves the output directory (%s)",
        async (_label, name) => {
            const { readDashboardBuild } =
                await import("../lib/dashboard-build");
            const build = readDashboardBuild(outDir({ a: { file: name } }))!;
            expect([...build.assets.keys()]).toEqual([]);
        }
    );

    it.each([
        ["no manifest at all", undefined, true],
        ["a corrupt manifest", "{not json", true],
        ["a manifest but no document", {}, false],
    ])("reads a missing build as null (%s)", async (_label, manifest, html) => {
        const { readDashboardBuild } = await import("../lib/dashboard-build");
        expect(readDashboardBuild(outDir(manifest, html))).toBeNull();
    });
});

/**
 * Comments out. Every assertion below is about what the CODE does, and these
 * modules document their own data boundary in prose — a comment must neither
 * fail the guard nor satisfy it (#2624).
 */
const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every relative static edge that survives the build — `import` and
 *  `export` both, since a re-export evaluates its target too; never an
 *  `import type`, which the build erases (the page names the trends' TYPES
 *  out of `scripts/lib/workflow-trends.ts`, whose own imports reach Node). */
const REACT_IMPORT_RE =
    /(?:import|export)\s(?!type\b)[^;]*["'](\.\.?\/[^"']+)["']/g;

const CANDIDATE_EXTENSIONS = ["", ".ts", ".tsx", ".js"];

/** Resolve a relative specifier the way the bundler does, and return the file
 *  it names — or `null` for one that is not a module (the stylesheet). */
const resolveEdge = (fromDir: string, spec: string): string | null => {
    for (const ext of CANDIDATE_EXTENSIONS) {
        const candidate = join(fromDir, spec + ext);
        if (!existsSync(candidate)) continue;
        return /\.(ts|tsx|js)$/.test(candidate) ? candidate : null;
    }
    return null;
};

/** Everything the page's entry reaches, over static AND dynamic edges. */
const pageClosure = (entry: string): string[] => {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.shift()!;
        if (seen.has(file)) continue;
        seen.add(file);
        const src = stripComments(readFileSync(file, "utf8"));
        for (const re of [
            REACT_IMPORT_RE,
            /import\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g,
        ])
            for (const m of src.matchAll(re)) {
                const next = resolveEdge(dirname(file), m[1]);
                if (next) queue.push(next);
            }
    }
    return [...seen];
};

describe("the cockpit page — one read, no action (issue #5652)", () => {
    const PAGE = pageClosure(join(REPO_REACT_DIR, "main.tsx"));

    it("the crawl really followed edges — into the panels and out to the shared reading", () => {
        expect(PAGE).toContain(join(REPO_REACT_DIR, "App.tsx"));
        expect(PAGE).toContain(
            join(REPO_REACT_DIR, "components", "cockpit", "CockpitView.tsx")
        );
        expect(PAGE).toContain(
            join(REPO_REACT_DIR, "..", "scripts", "lib", "cockpit-reading.ts")
        );
    });

    it("names no route but /api/cockpit — the Now view's, its actions' and History's are gone", () => {
        const routes = new Set<string>();
        for (const file of PAGE) {
            const src = stripComments(readFileSync(file, "utf8"));
            for (const m of src.matchAll(/\/api\/[a-z-]+/g)) routes.add(m[0]);
        }
        expect([...routes]).toEqual(["/api/cockpit"]);
    });

    it("sends nothing: no request but a plain GET leaves the page", () => {
        for (const file of PAGE) {
            const src = stripComments(readFileSync(file, "utf8"));
            expect(src, file).not.toMatch(/method:\s*["'](?!GET)/i);
            expect(src, file).not.toMatch(
                /\b(?:sendBeacon|EventSource|WebSocket)\b/
            );
        }
    });

    it("bundles no Node module — the page imports only what a browser can run", () => {
        const offenders: string[] = [];
        for (const file of PAGE) {
            const src = stripComments(readFileSync(file, "utf8"));
            for (const m of src.matchAll(
                /^import\s(?!type\b)[^;]*["']((?:node|bun):[^"']+)["']/gm
            ))
                offenders.push(`${file} imports ${m[1]}`);
        }
        expect(offenders).toEqual([]);
    });
});
