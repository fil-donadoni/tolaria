import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
    deploymentSizes,
    probeFunction,
    recordOrphans,
    sizesLine,
} from "../lib/convex-wedge";
import { heartbeatLines, tick } from "../lib/heartbeat";

// Issue #9227: a backend that answers HTTP but cannot run a function.

function serve(
    handler: http.RequestListener
): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve) => {
        const srv = http.createServer(handler).listen(0, "127.0.0.1", () => {
            const { port } = srv.address() as { port: number };
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => srv.close(),
            });
        });
    });
}

describe("probeFunction — one timed query round trip", () => {
    it("a prompt answer, even an error one, is healthy", async () => {
        const s = await serve((_q, r) =>
            r.end('{"status":"error","errorMessage":"no such function"}')
        );
        const v = await probeFunction(s.url, 2_000);
        s.close();
        expect(v.wedged).toBe(false);
    });

    it("no answer within the threshold is wedged", async () => {
        const s = await serve(() => {
            /* never answers: the wedge */
        });
        const v = await probeFunction(s.url, 150);
        s.close();
        expect(v.wedged).toBe(true);
        expect(v.reason).toMatch(/no answer within 150 ms/);
    });

    it("the backend's own function-timeout error is wedged", async () => {
        const s = await serve((_q, r) =>
            r.end(
                '{"errorMessage":"Function execution timed out (maximum duration: 1s)"}'
            )
        );
        const v = await probeFunction(s.url, 2_000);
        s.close();
        expect(v.wedged).toBe(true);
    });

    it("a refused connection is NOT a wedge (down is convex:ensure's job)", async () => {
        const s = await serve(() => {});
        s.close();
        const v = await probeFunction(s.url, 500);
        expect(v.wedged).toBe(false);
        expect(v.reason).toMatch(/unreachable/);
    });
});

describe("deploymentSizes — what a human reads", () => {
    it("stats the modules dir, sqlite with its WAL, and the recorded orphans", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "wedge-"));
        const dir = path.join(root, ".convex", "local", "default");
        fs.mkdirSync(path.join(dir, "convex_local_storage", "modules"), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(dir, "convex_local_storage", "modules", "a.blob"),
            "x".repeat(2_000_000)
        );
        fs.writeFileSync(
            path.join(dir, "convex_local_backend.sqlite3"),
            "y".repeat(3_000_000)
        );
        fs.writeFileSync(
            path.join(dir, "convex_local_backend.sqlite3-wal"),
            "z".repeat(1_000_000)
        );
        expect(sizesLine(deploymentSizes(root, 0))).toBe(
            "modules 2.0 MB, sqlite 4.0 MB, orphans not counted yet"
        );
        recordOrphans(root, 7, 0);
        expect(deploymentSizes(root, 0).orphaned).toBe(7);
        fs.rmSync(root, { recursive: true });
    });
});

describe("heartbeat — the convex line", () => {
    const base = {
        at: new Date(0).toISOString(),
        host: "mac",
        afkDispatch: { fire: false, reason: "r" },
        health: { fire: false, reason: "r" },
    };
    it("prints the probe outcome and the sizes", () => {
        const text = JSON.stringify({
            ...base,
            convex: {
                probe: "restarted",
                detail: "was wedged",
                sizes: {
                    at: "",
                    modulesBytes: 1e6,
                    sqliteBytes: 2e6,
                    orphaned: 3,
                },
            },
        });
        const out = heartbeatLines(text, 0).join("\n");
        expect(out).toContain("convex         RESTARTED — was wedged");
        expect(out).toContain(
            "modules 1.0 MB, sqlite 2.0 MB, 3 orphaned blobs"
        );
    });

    it("a throwing convexTick is recorded, never thrown", () => {
        const s = tick({
            host: "mac",
            now: () => 0,
            afkDispatchClock: () => ({ active: true, runs: [] }),
            healthFacts: () => {
                throw new Error("x");
            },
            queueGateFacts: () => ({ workflows: [], prs: [] }),
            convexTick: () => {
                throw new Error("boom");
            },
            dispatchAfk: () => {},
            dispatchHealthGate: () => {},
            dryRun: true,
        });
        expect(s.convex).toEqual({ probe: "failed", detail: "boom" });
    });
});
