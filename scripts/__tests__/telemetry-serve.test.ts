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

    it("Now reads /api/loop-status and posts to /api/action, and nothing else — no database route, direct or transitive", () => {
        // `/api/action` (#2628) joined the allow-list in #2636: the Now
        // view's action buttons (`actions.js`, reached from `main.js` via
        // `now-loop-status.js`) POST the three reversible driver operations
        // there. It reads no DB — same guarantee `/api/loop-status` gives —
        // so admitting it here does not reopen the thing this guard exists
        // to prevent (a DB-backed route reachable without telemetry.db).
        const ALLOWED = new Set(["/api/loop-status", "/api/action"]);
        for (const name of NOW_MODULES) {
            const src = stripComments(
                readFileSync(join(REPO_DASHBOARD_DIR, name), "utf8")
            );
            for (const m of src.matchAll(/\/api\/[a-z-]+/g)) {
                expect(ALLOWED.has(m[0]), `${name} reaches ${m[0]}`).toBe(true);
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

/**
 * #2628 — the action endpoint. Three reversible driver operations behind
 * three independent guards (loopback binding, boot token, `Origin`), and a
 * refusal for everything else.
 *
 * The guards are tested ONE AT A TIME with every other input valid, which is
 * what "independent, none a substitute for another" means operationally: a
 * request that satisfies two of the three is still refused. A suite that only
 * ever sent a fully-invalid request would pass against an implementation that
 * checked a single guard.
 */
const ACTION_ORIGIN = "http://127.0.0.1:5174";
const ACTION_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([ACTION_ORIGIN]);
/** Deliberately NOT a UUID: nothing in the handler may depend on the token's
 *  shape, only on an exact byte comparison against the boot value. */
const ACTION_TOKEN = "test-boot-token-abcdefghijklmnop";
const ACTION_TOKEN_HEADER = "x-loop-action-token";

/** Records which driver operation ran, and with what argument. The three
 *  operations are injected exactly like `getLoopStatus` / `readAsset`: the
 *  route's job is dispatch and refusal, and this is the seam that proves
 *  which of the two happened without writing a stop-file or calling `gh`. */
function recordingActions() {
    const calls: string[] = [];
    return {
        calls,
        driverActions: {
            stopDriver: async () => {
                calls.push("stopDriver");
            },
            resumeDriver: async () => {
                calls.push("resumeDriver");
            },
            releaseClaim: async (issue: number) => {
                calls.push(`releaseClaim:${issue}`);
            },
        },
    };
}

function actionRequest(
    body: unknown,
    opts: {
        token?: string | null;
        origin?: string | null;
        method?: string;
        rawBody?: string;
    } = {}
): Request {
    const headers = new Headers();
    if (opts.token !== null)
        headers.set(ACTION_TOKEN_HEADER, opts.token ?? ACTION_TOKEN);
    if (opts.origin !== null)
        headers.set("origin", opts.origin ?? ACTION_ORIGIN);
    const method = opts.method ?? "POST";
    return new Request(`${ACTION_ORIGIN}/api/action`, {
        method,
        headers,
        ...(method === "GET" || method === "HEAD"
            ? {}
            : { body: opts.rawBody ?? JSON.stringify(body) }),
    });
}

async function postAction(
    body: unknown,
    opts: Parameters<typeof actionRequest>[1] = {}
) {
    const { handleRequest } = await import("../telemetry-serve");
    const rec = recordingActions();
    const res = await handleRequest(actionRequest(body, opts), {
        actionToken: ACTION_TOKEN,
        allowedOrigins: ACTION_ALLOWED_ORIGINS,
        driverActions: rec.driverActions,
    });
    return { res, calls: rec.calls, text: await res.text() };
}

describe("telemetry-serve — action endpoint dispatch (#2628)", () => {
    it("driver.stop runs the stop operation and nothing else", async () => {
        const { res, calls } = await postAction({ action: "driver.stop" });
        expect(res.status).toBe(200);
        expect(calls).toEqual(["stopDriver"]);
    });

    it("driver.resume runs the resume operation and nothing else", async () => {
        const { res, calls } = await postAction({ action: "driver.resume" });
        expect(res.status).toBe(200);
        expect(calls).toEqual(["resumeDriver"]);
    });

    it("claim.release acts on exactly the issue named and no other", async () => {
        const { res, calls } = await postAction({
            action: "claim.release",
            issue: 2628,
        });
        expect(res.status).toBe(200);
        expect(calls).toEqual(["releaseClaim:2628"]);
    });

    it("claim.release refuses an issue that is not a positive integer — no operation runs", async () => {
        for (const issue of [
            undefined,
            null,
            "2628",
            "2628 2629",
            0,
            -1,
            1.5,
            NaN,
            [2628],
            { number: 2628 },
        ]) {
            const { res, calls } = await postAction({
                action: "claim.release",
                issue,
            });
            expect(
                res.status,
                `issue=${JSON.stringify(issue)} must be refused`
            ).toBe(400);
            expect(calls).toEqual([]);
        }
    });

    it("arming and disarming are absent from the allow-list — they stay a copied command by design", async () => {
        for (const action of [
            "driver.arm",
            "driver.disarm",
            "loop.arm",
            "arm",
            "disarm",
        ]) {
            const { res, calls } = await postAction({ action });
            expect(res.status, `${action} must be refused`).toBe(400);
            expect(calls).toEqual([]);
        }
    });

    it("only POST reaches the endpoint", async () => {
        const { res, calls } = await postAction(
            { action: "driver.stop" },
            { method: "GET" }
        );
        expect(res.status).toBe(405);
        expect(calls).toEqual([]);
    });
});

describe("telemetry-serve — action endpoint guards (#2628)", () => {
    it("REFUSAL 1 — a request with no token is refused, with Origin and action both valid", async () => {
        const { res, calls, text } = await postAction(
            { action: "driver.stop" },
            { token: null }
        );
        expect(res.status).toBe(401);
        expect(calls).toEqual([]);
        // The refusal must never echo the real token back to the caller.
        expect(text).not.toContain(ACTION_TOKEN);
    });

    it("REFUSAL 2 — a request with a wrong token is refused, with Origin and action both valid", async () => {
        for (const wrong of [
            "",
            "nope",
            ACTION_TOKEN.slice(0, -1),
            ACTION_TOKEN + "x",
            // Case matters: the comparison is over bytes, not over a
            // normalised form.
            ACTION_TOKEN.toUpperCase(),
        ]) {
            const { res, calls, text } = await postAction(
                { action: "driver.stop" },
                { token: wrong }
            );
            expect(res.status, `token=${JSON.stringify(wrong)}`).toBe(401);
            expect(calls).toEqual([]);
            expect(text).not.toContain(ACTION_TOKEN);
        }
    });

    it("surrounding whitespace on the TOKEN never reaches the handler — the header layer strips it, so this is a transport fact, not a forgiving comparison", () => {
        // Recorded because the obvious "fix" for the assertion below is to
        // add a `trim()` in the handler, which would be a normalisation the
        // action allow-list deliberately refuses to do (REFUSAL 4). Header
        // values carry no leading/trailing OWS by the time any handler runs
        // (RFC 9110 §5.5), so ` <token> ` and `<token>` are the SAME header
        // value on the wire and the handler cannot distinguish them.
        // Whitespace sensitivity is meaningful for the action name, which
        // arrives in a JSON body where it survives — and that is where the
        // acceptance criterion asks for it.
        const headers = new Headers();
        headers.set(ACTION_TOKEN_HEADER, ` ${ACTION_TOKEN} `);
        expect(headers.get(ACTION_TOKEN_HEADER)).toBe(ACTION_TOKEN);
    });

    it("REFUSAL 3 — a disallowed Origin is refused, with token and action both valid", async () => {
        for (const origin of [
            "http://evil.example",
            "https://evil.example",
            // A page on ANOTHER local port is another origin: the allow-list
            // is literal and port-scoped, not "any loopback host".
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            // The opaque-origin serialisation a sandboxed frame sends.
            "null",
            ACTION_ORIGIN + "/",
            ACTION_ORIGIN.toUpperCase(),
        ]) {
            const { res, calls } = await postAction(
                { action: "driver.stop" },
                { origin }
            );
            expect(res.status, `origin=${origin}`).toBe(403);
            expect(calls).toEqual([]);
        }
    });

    it("REFUSAL 3b — a MISSING Origin is refused too (fail closed), with token and action both valid", async () => {
        const { res, calls } = await postAction(
            { action: "driver.stop" },
            { origin: null }
        );
        expect(res.status).toBe(403);
        expect(calls).toEqual([]);
    });

    it("REFUSAL 4 — an action outside the allow-list is refused, including one differing only in case or whitespace", async () => {
        for (const action of [
            // unknown outright
            "driver.restart",
            "claim.take",
            "",
            // case
            "Driver.Stop",
            "DRIVER.STOP",
            "Claim.Release",
            // whitespace
            " driver.stop",
            "driver.stop ",
            " driver.stop ",
            "driver.stop\n",
            "\tdriver.resume",
            // prototype keys — the allow-list is a Map, so these are ordinary
            // misses rather than inherited truthy values
            "__proto__",
            "constructor",
            "toString",
        ]) {
            const { res, calls } = await postAction({ action });
            expect(res.status, `action=${JSON.stringify(action)}`).toBe(400);
            expect(calls).toEqual([]);
        }
    });

    it("a non-string action, a non-object body and malformed JSON are all refused", async () => {
        for (const body of [
            { action: 1 },
            { action: null },
            { action: ["driver.stop"] },
            { action: { toString: () => "driver.stop" } },
            {},
            null,
            42,
            "driver.stop",
        ]) {
            const { res, calls } = await postAction(body);
            expect(res.status, `body=${JSON.stringify(body)}`).toBe(400);
            expect(calls).toEqual([]);
        }
        const { res, calls } = await postAction(undefined, {
            rawBody: "{not json",
        });
        expect(res.status).toBe(400);
        expect(calls).toEqual([]);
    });

    it("the guards are independent — satisfying two of the three is still a refusal", async () => {
        // token ✓ Origin ✗ action ✓
        expect(
            (
                await postAction(
                    { action: "driver.stop" },
                    { origin: "http://x" }
                )
            ).res.status
        ).toBe(403);
        // token ✗ Origin ✓ action ✓
        expect(
            (await postAction({ action: "driver.stop" }, { token: "wrong" }))
                .res.status
        ).toBe(401);
        // token ✓ Origin ✓ action ✗
        expect((await postAction({ action: "Driver.Stop" })).res.status).toBe(
            400
        );
    });
});

describe("telemetry-serve — action token lifecycle (#2628)", () => {
    it("the boot token is injected into the served page, once, inside <head>", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const shell = readFileSync(
            join(import.meta.dirname, "..", "telemetry-dashboard.html"),
            "utf8"
        );
        const res = await handleRequest(new Request(`${ACTION_ORIGIN}/`), {
            readAsset: async () => shell,
            actionToken: ACTION_TOKEN,
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        const tags = html.match(/<meta name="loop-action-token"/g) ?? [];
        expect(tags).toHaveLength(1);
        expect(html).toContain(
            `<meta name="loop-action-token" content="${ACTION_TOKEN}"`
        );
        expect(html.indexOf("loop-action-token")).toBeLessThan(
            html.indexOf("</head>")
        );
    });

    it("the shipped shell carries exactly one </head>, so the injection can never silently no-op", () => {
        const shell = readFileSync(
            join(import.meta.dirname, "..", "telemetry-dashboard.html"),
            "utf8"
        );
        expect(shell.match(/<\/head>/g) ?? []).toHaveLength(1);
    });

    it("the token is escaped on the way into the page — a token can never break out of the attribute", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const res = await handleRequest(new Request(`${ACTION_ORIGIN}/`), {
            readAsset: async () => "<html><head></head><body></body></html>",
            actionToken: `"><script>alert(1)</script>`,
        });
        const html = await res.text();
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&quot;&gt;&lt;script&gt;");
    });

    it("the token is never persisted and never logged — the module's only console call is the boot banner", () => {
        const src = readFileSync(
            join(import.meta.dirname, "..", "telemetry-serve.ts"),
            "utf8"
        );
        const consoleCalls = src.match(/console\.\w+\(/g) ?? [];
        expect(consoleCalls).toHaveLength(1);
        const bannerLine = src
            .split("\n")
            .find(
                (l) => l.includes("console.") && !l.trimStart().startsWith("*")
            );
        expect(bannerLine).toContain("telemetry dashboard →");
        // Nothing writes the token (or anything else) to disk from here.
        expect(src).not.toMatch(/writeFile|appendFile|writeFileSync/);
    });

    it("no exported binding leaks the boot token", async () => {
        const mod = (await import("../telemetry-serve")) as Record<
            string,
            unknown
        >;
        const uuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        for (const [name, value] of Object.entries(mod)) {
            expect(
                typeof value === "string" && uuid.test(value),
                `export ${name} looks like the boot token`
            ).toBe(false);
        }
    });

    it("the default Origin allow-list is the loopback literals at the bound port — never derived from the request's own Host", async () => {
        const { loopbackOrigins } = await import("../telemetry-serve");
        expect([...loopbackOrigins(5174)].sort()).toEqual(
            [
                "http://127.0.0.1:5174",
                "http://[::1]:5174",
                "http://localhost:5174",
            ].sort()
        );
        // A DNS-rebinding page reaches the server with Host: evil.example, so
        // an allow-list derived from `req.url` would admit it. This one is
        // built from literals, so it cannot.
        expect(loopbackOrigins(5174).has("http://evil.example:5174")).toBe(
            false
        );
    });
});

/**
 * #2628 review round 1 — the three findings the 45 tests above could not
 * catch, because every one of them injected a stub `DriverActions` and a
 * present `actionToken` / `allowedOrigins`. What went unasserted was
 * therefore: (a) the argv the PRODUCTION actions build, (b) that the `??`
 * resolution of the security deps actually refuses an explicitly-undefined
 * one, (c) that an empty token is not a token.
 */

/**
 * The modes `scripts/loop-handoff.sh` ACCEPTS, read out of the script's own
 * argv `case`. This is the load-bearing half of the argv test: pinning
 * `"--stop"` on both sides would only restate the implementation, whereas
 * parsing the script means the assertion reds if EITHER side drifts — the
 * bare-word invocation this replaced, or a future rename of the mode itself.
 *
 * The mode branch is the one `case` alternative made entirely of `--word`
 * spellings (`--start | --resume | --stop | …)`); `-h | --help)` does not
 * match (it starts with a single dash) and the option-with-value branches are
 * one alternative each. Finding exactly one such line is asserted, so a
 * restructured parser fails loudly here rather than silently widening the set.
 */
function loopHandoffModes(): readonly string[] {
    const src = readFileSync(
        join(import.meta.dirname, "..", "loop-handoff.sh"),
        "utf8"
    );
    const branches = src
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^--[a-z][a-z-]*(\s*\|\s*--[a-z][a-z-]*)+\)$/.test(l));
    expect(
        branches,
        "expected exactly one multi-alternative --mode branch in loop-handoff.sh's argv case"
    ).toHaveLength(1);
    const modes = branches[0]
        .slice(0, -1)
        .split("|")
        .map((s) => s.trim());
    expect(modes.length).toBeGreaterThan(1);
    return modes;
}

/** Runs the REAL `makeDriverActions` over a recording spawn — the same
 *  factory `defaultDriverActions` is built from, so what is asserted is what
 *  production would execute, never a copy of it written out again here. */
async function spawnedArgv() {
    const { makeDriverActions } = await import("../telemetry-serve");
    const spawned: string[][] = [];
    const actions = makeDriverActions(async (argv) => {
        spawned.push([...argv]);
    });
    await actions.stopDriver();
    await actions.resumeDriver();
    await actions.releaseClaim(2628);
    return spawned;
}

describe("telemetry-serve — the real driver operations' argv (#2628)", () => {
    it("spawns the three commands verbatim, with no shell in between", async () => {
        expect(await spawnedArgv()).toEqual([
            ["sh", "scripts/loop-handoff.sh", "--stop"],
            ["sh", "scripts/loop-handoff.sh", "--resume"],
            [
                "gh",
                "issue",
                "edit",
                "2628",
                "--remove-label",
                "in-progress",
                "--remove-assignee",
                "@me",
            ],
        ]);
    });

    it("every mode it hands loop-handoff.sh is one that script's own argv parser accepts", async () => {
        const modes = loopHandoffModes();
        const handoffCalls = (await spawnedArgv()).filter((argv) =>
            argv.some((tok) => tok.endsWith("loop-handoff.sh"))
        );
        // Both driver operations go through the script — if one stopped, the
        // cross-check below would vacuously pass on the remainder.
        expect(handoffCalls).toHaveLength(2);
        for (const argv of handoffCalls) {
            const mode = argv[argv.findIndex((t) => t.endsWith(".sh")) + 1];
            expect(
                modes,
                `loop-handoff.sh's argv parser refuses "${mode}" — it falls to the '*)' branch, prints the usage and exits 2`
            ).toContain(mode);
        }
    });

    it("the issue number reaches gh as its own argv element — never spliced into a string", async () => {
        const { DRIVER_COMMANDS } = await import("../telemetry-serve");
        // The integer check in the handler is what actually holds; this pins
        // the second line of defence, that even a hostile value would arrive
        // as one opaque argument rather than as further flags.
        expect(DRIVER_COMMANDS.releaseClaim(2628)).toContain("2628");
        expect(
            DRIVER_COMMANDS.releaseClaim(2628).filter((t) => t.includes("2628"))
        ).toEqual(["2628"]);
    });
});

describe("telemetry-serve — an explicitly-undefined dep never disarms a guard (#2628)", () => {
    it("resolveSecurityDeps falls back to the boot values, key by key", async () => {
        const { resolveSecurityDeps } = await import("../telemetry-serve");
        const resolved = resolveSecurityDeps({
            actionToken: undefined,
            allowedOrigins: undefined,
            driverActions: undefined,
        });
        // A spread would hand back three `undefined`s here — the exact
        // disarming the `??` exists to prevent.
        expect(typeof resolved.actionToken).toBe("string");
        expect(resolved.actionToken.length).toBeGreaterThan(0);
        expect(resolved.allowedOrigins.size).toBeGreaterThan(0);
        expect(resolved.allowedOrigins.has("http://evil.example")).toBe(false);
        expect(Object.keys(resolved.driverActions).sort()).toEqual([
            "releaseClaim",
            "resumeDriver",
            "stopDriver",
        ]);
    });

    it("an undefined allowedOrigins still refuses a foreign Origin (403, not a 400 from a thrown guard)", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const rec = recordingActions();
        const res = await handleRequest(
            actionRequest(
                { action: "driver.stop" },
                { origin: "http://evil.example" }
            ),
            {
                actionToken: ACTION_TOKEN,
                allowedOrigins: undefined,
                driverActions: rec.driverActions,
            }
        );
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
            ok: false,
            error: "disallowed Origin",
        });
        expect(rec.calls).toEqual([]);
    });

    it("an undefined actionToken still refuses a presented token (401, not a 400 from a thrown guard)", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const rec = recordingActions();
        const res = await handleRequest(
            actionRequest({ action: "driver.stop" }, { token: "anything" }),
            {
                actionToken: undefined,
                allowedOrigins: ACTION_ALLOWED_ORIGINS,
                driverActions: rec.driverActions,
            }
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
            ok: false,
            error: "invalid action token",
        });
        expect(rec.calls).toEqual([]);
    });
});

describe("telemetry-serve — an empty token authenticates nothing (#2628)", () => {
    it("refuses a request presenting an empty token against an empty configured token", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const rec = recordingActions();
        // `timingSafeEqual` on two empty buffers returns true, so without the
        // explicit refusal this dispatches — an empty token would be a
        // universal key rather than a closed door.
        const res = await handleRequest(
            actionRequest({ action: "driver.stop" }, { token: "" }),
            {
                actionToken: "",
                allowedOrigins: ACTION_ALLOWED_ORIGINS,
                driverActions: rec.driverActions,
            }
        );
        expect(res.status).toBe(401);
        expect(rec.calls).toEqual([]);
    });

    it("refuses every other token too, when the configured one is empty", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        const rec = recordingActions();
        const res = await handleRequest(
            actionRequest({ action: "driver.stop" }, { token: "guess" }),
            {
                actionToken: "",
                allowedOrigins: ACTION_ALLOWED_ORIGINS,
                driverActions: rec.driverActions,
            }
        );
        expect(res.status).toBe(401);
        expect(rec.calls).toEqual([]);
    });
});

describe("telemetry-serve — the token injection is literal (#2628)", () => {
    it("a token full of $-replacement patterns lands verbatim, splicing no document text", async () => {
        const { handleRequest } = await import("../telemetry-serve");
        // `$&`, "$`", "$'" and `$1` are the four replacement patterns
        // `String.prototype.replace` reads in a STRING replacement;
        // `escapeAttribute` does not escape `$`, so a string replacement would
        // expand them against the surrounding document.
        const token = "a$&b$`c$'d$1e";
        const res = await handleRequest(new Request(`${ACTION_ORIGIN}/`), {
            readAsset: async () =>
                "<html><head><title>BEFORE</title></head><body>AFTER</body></html>",
            actionToken: token,
        });
        const html = await res.text();
        // escapeAttribute turns `&` into `&amp;` and `'` into `&#39;`; the `$`
        // signs and the backtick are its business to leave alone.
        expect(html).toContain('content="a$&amp;b$`c$&#39;d$1e"');
        expect(html).not.toContain("BEFOREBEFORE");
        expect(html.match(/BEFORE/g) ?? []).toHaveLength(1);
        expect(html.match(/AFTER/g) ?? []).toHaveLength(1);
    });
});
