import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
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
