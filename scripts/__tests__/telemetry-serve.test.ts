import { describe, it, expect } from "vitest";
import { createServer } from "node:net";

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

describe("telemetry-serve — bootstrap guard (#2623)", () => {
    it("importing the module opens no port — not even the module's own resolved default", async () => {
        // Deliberately NOT the real default (5174): this machine can have a
        // live `bun run telemetry:dash` an operator is watching (observed
        // running here during development), and probing the literal
        // well-known port would make this test collide with a legitimate,
        // unrelated process rather than with a regression in THIS module.
        // `TELEMETRY_SERVE_PORT` (read by `resolvePort()`, only reachable
        // through `startServer()`) redirects what a regressed guard would
        // bind to this private, otherwise-unused port instead — this must
        // be set before the FIRST import of the module in this worker
        // (module top-level code, including a broken guard, runs exactly
        // once, at that first import).
        const testPort = 48173;
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
        // A fresh worktree never has `.claude/telemetry/telemetry.db`
        // (`worktree:init` does not copy it), so `/api/meta` — a genuinely
        // DB-backed route — 503s here for real, confirming the store really
        // is absent for this test run. Route order (#2519) dispatches
        // loop-status before any DB-backed route, so this is the property
        // that makes the next assertion meaningful rather than vacuous.
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
