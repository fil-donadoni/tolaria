import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `telemetry-serve.ts` (#2623) — the request handler extracted from the
 * `Bun.serve` listener so every route is callable with an in-memory
 * `Request`. This suite runs in the `node` vitest project (confirmed by
 * hand: the plain `Bun` global and `bun:sqlite` are BOTH unavailable here —
 * `node[all]`/`bunx vitest run --project node`, `check-lane.ts`'s own
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

/**
 * `telemetry-serve.ts`'s `DB_PATH` resolves from `CLAUDE_PROJECT_DIR ??
 * cwd()` AT IMPORT TIME (#2623 review round 1, finding 1) — if that ever
 * points at a checkout with a real `.claude/telemetry/telemetry.db` (the
 * primary checkout has one, 228MB at review time), the module's own
 * `existsSync(DB_PATH)` check comes back true and reaches
 * `require("bun:sqlite")`, which does not exist under this Node runtime.
 * Confirmed: `CLAUDE_PROJECT_DIR=<primary checkout> bunx vitest run
 * --project node scripts/__tests__/telemetry-serve.test.ts` reds all 4
 * tests without this pin. Setting `CLAUDE_PROJECT_DIR` to a fresh, empty
 * temp directory BEFORE the module's first import (module top-level code
 * runs once, at that first `import()`, so this MUST happen before any `it`
 * body runs — hence top-level here, not inside a `beforeAll`) removes the
 * dependency on the machine's ambient state entirely: this suite's result
 * no longer depends on whether a telemetry store happens to exist.
 */
const testProjectDir = mkdtempSync(join(tmpdir(), "telemetry-serve-test-"));
const prevProjectDir = process.env.CLAUDE_PROJECT_DIR;
process.env.CLAUDE_PROJECT_DIR = testProjectDir;

afterAll(() => {
    if (prevProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prevProjectDir;
    rmSync(testProjectDir, { recursive: true, force: true });
});

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
        // can have a live `bun run telemetry:dash` an operator is watching
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

describe("telemetry-serve — handleRequest routes (#2623)", () => {
    it("the loop-status route answers through an in-memory Request — no port, no gh/git call", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const stubStatus = { driver: { armed: false }, batch: null };
        const res = await handleRequest(
            new Request("http://127.0.0.1/api/loop-status"),
            { getLoopStatus: async () => stubStatus }
        );
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual(stubStatus);
    });

    it("the loop-status route survives a missing telemetry store — proven by /api/meta 503ing on the same, store-absent run", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        // `/api/meta` — a genuinely DB-backed route — 503s here for real,
        // which confirms the telemetry store really is absent for this
        // test run (`CLAUDE_PROJECT_DIR` is pinned to an empty temp dir
        // above). The invariant the next assertion guards is NOT route
        // dispatch order — matching is exact-path, so `/api/loop-status`
        // would answer identically no matter where it sat in the dispatch
        // list. It's that `/api/loop-status`'s own handler never calls
        // `requireDb()` at all, only `deps.getLoopStatus()`, so a missing
        // store can never surface as a 503 on this route the way it does
        // on `/api/meta`.
        const meta = await handleRequest(
            new Request("http://127.0.0.1/api/meta")
        );
        expect(meta.status).toBe(503);

        const loopStatus = await handleRequest(
            new Request("http://127.0.0.1/api/loop-status"),
            { getLoopStatus: async () => ({ ok: true }) }
        );
        expect(loopStatus.status).toBe(200);
    });

    it("an unknown route falls back to 404", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request("http://127.0.0.1/api/does-not-exist")
        );
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toBe("not found");
    });
});

/**
 * #2625 — the dashboard stopped being one 1853-line file and became a shell
 * plus a stylesheet plus one ES module per concern, served by a new static
 * route. These are that route's guards plus the two invariants the split could
 * silently break: which files are reachable, and which data each view reads.
 *
 * `REPO_DASHBOARD_DIR` is the real checkout, deliberately NOT
 * `CLAUDE_PROJECT_DIR` (pinned to an empty temp dir above so the module never
 * finds a telemetry store): the census below asks what is actually committed.
 */
const REPO_DASHBOARD_DIR = join(import.meta.dirname, "..", "dashboard");

describe("telemetry-serve — dashboard asset allow-list (#2625)", () => {
    it("serves an allow-listed asset, and asks the filesystem for the LIST's path — never for the request's text", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const asked: string[] = [];
        const res = await handleRequest(
            new Request("http://127.0.0.1/assets/main.js"),
            {
                readAsset: async (p) => {
                    asked.push(p);
                    return "// served";
                },
            }
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe(
            "text/javascript; charset=utf-8"
        );
        await expect(res.text()).resolves.toBe("// served");
        expect(asked).toHaveLength(1);
        expect(asked[0].endsWith(join("scripts", "dashboard", "main.js"))).toBe(
            true
        );
    });

    it("serves the stylesheet as CSS", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(
            new Request("http://127.0.0.1/assets/dashboard.css"),
            { readAsset: async () => "body{}" }
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    });

    /**
     * PROOF-OF-FAILURE (recorded in the PR): replacing the `Map.get`
     * allow-list lookup in `handleRequest` with the naive
     * `readAsset(join(DASHBOARD_DIR, name))` reds every case below — the
     * traversals resolve and return file contents instead of 404, and
     * `evil.js` reaches the filesystem. Reverted after watching it fail.
     *
     * Each row is a DIFFERENT way of spelling "not on the list", because the
     * failure mode of a sanitiser is that it handles the spelling its author
     * thought of. An allow-list has no spellings to handle: the request text
     * is a Map key, so every one of these is simply absent.
     */
    it.each([
        ["a name that is not on the list", "/assets/evil.js"],
        ["a plain traversal", "/assets/../telemetry-serve.ts"],
        ["a deep traversal", "/assets/../../package.json"],
        ["a percent-encoded traversal", "/assets/%2e%2e%2ftelemetry-serve.ts"],
        ["a double-encoded traversal", "/assets/%252e%252e%252fpackage.json"],
        ["a backslash traversal", "/assets/..\\telemetry-serve.ts"],
        ["an absolute path", "/assets//etc/passwd"],
        ["a nested path under a listed name", "/assets/main.js/../../.env"],
        ["a prototype key", "/assets/__proto__"],
        ["a constructor key", "/assets/constructor"],
        ["the empty name", "/assets/"],
        ["a listed name with a query-ish suffix", "/assets/main.js%00.txt"],
    ])("refuses %s", async (_label, pathname) => {
        const { handleRequest } = await import("../telemetry-serve");
        let reads = 0;
        const res = await handleRequest(
            new Request(`http://127.0.0.1${pathname}`),
            {
                readAsset: async () => {
                    reads += 1;
                    return "LEAKED";
                },
            }
        );
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toBe("not found");
        // The stronger claim: refused BY CONSTRUCTION. Nothing was read.
        expect(reads).toBe(0);
    });

    it("the allow-list and scripts/dashboard/ are the same set — a module that lands without an entry would 404", async () => {
        const { DASHBOARD_ASSET_NAMES } = await import("../telemetry-serve");
        const onDisk = readdirSync(REPO_DASHBOARD_DIR).sort();
        expect([...DASHBOARD_ASSET_NAMES].sort()).toEqual(onDisk);
    });

    it("every relative import in every dashboard module resolves to an allow-listed file", async () => {
        const { DASHBOARD_ASSET_NAMES } = await import("../telemetry-serve");
        const allowed = new Set<string>(DASHBOARD_ASSET_NAMES);
        for (const name of readdirSync(REPO_DASHBOARD_DIR)) {
            if (!name.endsWith(".js")) continue;
            const src = readFileSync(join(REPO_DASHBOARD_DIR, name), "utf8");
            for (const m of src.matchAll(/["']\.\/([^"']+)["']/g)) {
                expect(
                    allowed.has(m[1]),
                    `${name} imports ./${m[1]}, which is not served`
                ).toBe(true);
            }
        }
    });

    it("the shell loads the entry module and the stylesheet through /assets/", () => {
        const shell = readFileSync(
            join(import.meta.dirname, "..", "telemetry-dashboard.html"),
            "utf8"
        );
        expect(shell).toContain('href="/assets/dashboard.css"');
        expect(shell).toContain(
            '<script type="module" src="/assets/main.js"></script>'
        );
        // The shell is a shell: no inline behaviour or styling survived.
        expect(shell).not.toContain("<style");
        expect(shell).not.toMatch(/<script(?![^>]*\bsrc=)/);
    });
});

/**
 * Comments out. Every assertion below is about what the CODE does, and these
 * modules document their own data boundary in prose — `main.js`'s banner names
 * `/api/meta` to explain why History is loaded the way it is. Scanning the raw
 * text would let a comment fail the guard, and (the direction that matters)
 * would let a comment SATISFY one, which is the exact trap #2624 recorded.
 */
const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * A STATIC module edge, and only a static one. Two keywords, because BOTH
 * evaluate the target before the importer's first line: `import ... from` and
 * the re-export `export { x } from "./y.js"`. Matching only `import` left the
 * re-export invisible, and a single `export { state } from
 * "./history-state.js"` reintroduced the eager History load and the `/api/meta`
 * read #2519 forbids with every assertion below still green (measured — see the
 * PR's proof-of-failure table). Nothing else in the repo would have caught it:
 * `eslint.config.js` scopes every rule to `**\/*.{ts,tsx}`, so
 * `scripts/dashboard/*.js` is unlinted.
 *
 * The keyword is followed by whitespace, so `await import("./history-boot.js")`
 * — no whitespace after the keyword — is deliberately not matched. That
 * exclusion is the point: the dynamic edge is exactly the one #2519 requires
 * History to stay behind. `[^;]*` spans newlines, so a multi-line named-import
 * list (`history-narrative.js:3-8`) is one match; it also stops at the first
 * `;`, so `export const leak = () => fetch(...)` cannot be mistaken for an
 * edge.
 *
 * One shape stays outside, and only the formatter keeps it there: a
 * semicolon-less pair (`import { a } from "./x.js"` newline `import { b } from
 * "./y.js";`) loses the first specifier to the greedy `[^;]*`. `.prettierrc`
 * sets `semi: true`, `scripts/dashboard/` is not prettier-ignored, and
 * `check:all` VERIFIES formatting — so that input cannot reach `main`.
 */
const STATIC_IMPORT_RE = /(?:import|export)\s[^;]*["']\.\/([^"']+)["']/g;

/**
 * Everything reachable from `main.js` over static import edges — the
 * transitive closure, CRAWLED, never listed. A hand-maintained list sees only
 * the edges its author remembered: with one, `tabs.js -> svg.js ->
 * history-state.js` reintroduces both the eager History load and the DB read
 * #2519 forbids while every assertion below stays green (measured — see the
 * PR's proof-of-failure table). Deriving the set means a new static edge at
 * any depth, in any module — `import ... from` or a re-export alike — is
 * inside the guards the moment it is written, with the single
 * formatter-excluded shape named on `STATIC_IMPORT_RE` above.
 */
const nowClosure = (): string[] => {
    const seen = new Set<string>();
    const queue = ["main.js"];
    while (queue.length > 0) {
        const name = queue.shift()!;
        if (seen.has(name)) continue;
        seen.add(name);
        const src = stripComments(
            readFileSync(join(REPO_DASHBOARD_DIR, name), "utf8")
        );
        for (const m of src.matchAll(STATIC_IMPORT_RE)) queue.push(m[1]);
    }
    return [...seen];
};

describe("telemetry dashboard — Now/History data boundary (#2625)", () => {
    /** Everything reachable from `main.js` WITHOUT loading History. */
    const NOW_MODULES = nowClosure();

    it("the Now closure is crawled from main.js, transitively — a one-hop crawl would pass the guards below vacuously", () => {
        // `format.js` is reachable only at depth 2 (main.js ->
        // now-loop-status.js -> format.js): it is here iff the crawl really
        // followed an edge out of a module main.js does not import itself.
        expect(NOW_MODULES).toContain("main.js");
        expect(NOW_MODULES).toContain("now-loop-status.js");
        expect(NOW_MODULES).toContain("format.js");
    });

    it("Now reads /api/loop-status and nothing else — no database route, direct or transitive", () => {
        for (const name of NOW_MODULES) {
            const src = stripComments(
                readFileSync(join(REPO_DASHBOARD_DIR, name), "utf8")
            );
            for (const m of src.matchAll(/\/api\/[a-z-]+/g)) {
                expect(m[0], `${name} reaches ${m[0]}`).toBe(
                    "/api/loop-status"
                );
            }
        }
    });

    it("no module in the Now closure is a History module — a static edge, at any depth, would drag the store-backed graph into the Now load", () => {
        expect(
            NOW_MODULES.filter((name) => name.startsWith("history-")),
            "reachable from main.js without a dynamic import"
        ).toEqual([]);
    });

    it("History is reached only through a dynamic import inside main.js's try/catch — #2519's guarantee, preserved across the module split", () => {
        const main = stripComments(
            readFileSync(join(REPO_DASHBOARD_DIR, "main.js"), "utf8")
        );
        // Now is started before History is even fetched…
        const pollAt = main.indexOf("startLoopStatusPolling()");
        const historyAt = main.indexOf('import("./history-boot.js")');
        expect(pollAt).toBeGreaterThan(-1);
        expect(historyAt).toBeGreaterThan(pollAt);
        // …and History's whole load+bootstrap sits inside a catch.
        expect(main.slice(historyAt)).toMatch(/}\s*catch/);
        // A static import of history-boot would defeat all of the above:
        // statically imported modules evaluate before main.js's first line.
        expect(main).not.toMatch(/^import\s[^;]*history-/m);
    });
});
