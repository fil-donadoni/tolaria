import { describe, it, expect } from "vitest";

/**
 * `telemetry-serve.ts` (#2623) — the request handler extracted from the
 * `Bun.serve` listener so every route is callable with an in-memory
 * `Request`. Every `import()` below is deliberate rather than hoisted to
 * the top of the file: it is what makes `import.meta.main` read `false`
 * for the target module in the first place (Bun sets it `true` only for
 * the process's entry-point module, never for one reached via `import`) —
 * exactly the condition `startServer()` is gated on in production. If that
 * guard were ever weakened (the `if (import.meta.main)` check dropped, or
 * `startServer()` called unconditionally at module scope), the very first
 * `import` in this file would eagerly bind the default port before any
 * test body ran — the "silent real port under the parallel gate" failure
 * mode this issue exists to prevent. No `vi.mock` / `vi.spyOn` / fake
 * timers here — the `node` vitest project runs with `isolate: false` on
 * the promise that these files hold no such state to leak between them.
 */
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
        const testPort = "48173";
        const prevPort = process.env.TELEMETRY_SERVE_PORT;
        process.env.TELEMETRY_SERVE_PORT = testPort;
        try {
            await import("../telemetry-serve");
            // If the import above had wrongly called `startServer()` (a
            // dropped/weakened `import.meta.main` guard), it already bound
            // `testPort`, and this bind attempt throws EADDRINUSE.
            const probe = Bun.serve({
                port: Number(testPort),
                hostname: "127.0.0.1",
                fetch: () => new Response("probe"),
            });
            probe.stop(true);
        } finally {
            if (prevPort === undefined) delete process.env.TELEMETRY_SERVE_PORT;
            else process.env.TELEMETRY_SERVE_PORT = prevPort;
        }
    });

    it("startServer binds a real loopback socket, on an OS-assigned port, and serves through the same handler", async () => {
        const { startServer } = await import("../telemetry-serve");
        const server = startServer(0);
        try {
            expect(server.hostname).toBe("127.0.0.1");
            expect(server.port).toBeGreaterThan(0);
            const res = await fetch(`http://127.0.0.1:${server.port}/api/nope`);
            expect(res.status).toBe(404);
        } finally {
            server.stop(true);
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
