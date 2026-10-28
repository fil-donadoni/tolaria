import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
    MIN_BLOB_AGE_MS,
    SWEEP_INTERVAL_MS,
    classifyBlobs,
    readReferencedKeys,
    runAutoSweep,
    sweepBlobs,
    sweepDue,
    writeSweepStamp,
    type BlobOnDisk,
    type SweepDeps,
} from "../lib/convex-blob-gc";

const NOW = 1_800_000_000_000;
const old = (id: string, bytes = 10): BlobOnDisk => ({
    id,
    bytes,
    mtimeMs: NOW - MIN_BLOB_AGE_MS - 1,
});

describe("classifyBlobs (issue #3186)", () => {
    it("removes only old unreferenced blobs", () => {
        const c = classifyBlobs(
            [old("a", 5), old("b", 7), old("c")],
            new Set(["c"]),
            NOW
        );
        expect(c.removable.map((b) => b.id)).toEqual(["a", "b"]);
        expect(c.reclaimableBytes).toBe(12);
        expect(c.referenced).toBe(1);
        expect(c.orphaned).toBe(2);
    });

    it("never removes a referenced blob, even one only a superseded version names", () => {
        // The key set is the union over every document VERSION, so a key that
        // only a superseded source-package row names is still in it.
        const c = classifyBlobs([old("v1"), old("v2")], new Set(["v1"]), NOW);
        expect(c.removable.map((b) => b.id)).toEqual(["v2"]);
        expect(c.retained).toEqual([
            { id: "v1", reason: "referenced by a source package" },
        ]);
    });

    it("keeps an unreferenced blob under 24h, saying why", () => {
        const fresh = { id: "f", bytes: 1, mtimeMs: NOW - MIN_BLOB_AGE_MS + 1 };
        const c = classifyBlobs([fresh], new Set(), NOW);
        expect(c.removable).toEqual([]);
        expect(c.retained[0].reason).toMatch(/younger than 24h/);
    });
});

describe("sweepDue / stamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "blobgc-"));
    const stamp = join(dir, "stamp");
    it("is due without a stamp, then not for seven days", () => {
        expect(sweepDue(stamp, NOW)).toBe(true);
        writeSweepStamp(stamp, NOW);
        expect(sweepDue(stamp, NOW + SWEEP_INTERVAL_MS - 1)).toBe(false);
        expect(sweepDue(stamp, NOW + SWEEP_INTERVAL_MS)).toBe(true);
    });
    it("treats a garbled stamp as due", () => {
        writeFileSync(stamp, "nope");
        expect(sweepDue(stamp, NOW)).toBe(true);
    });
});

describe("readReferencedKeys", () => {
    const sleep = async () => {};
    it("retries a locked database then succeeds", async () => {
        let n = 0;
        const r = await readReferencedKeys(
            () => {
                if (++n < 3) throw new Error("SQLITE_BUSY: database is locked");
                return ["k"];
            },
            { attempts: 5, sleep }
        );
        expect(r).toEqual({ kind: "keys", keys: new Set(["k"]) });
    });
    it("reports a skip, not a throw, once retries are exhausted", async () => {
        const r = await readReferencedKeys(
            () => {
                throw new Error("database is locked");
            },
            { attempts: 3, sleep }
        );
        expect(r.kind).toBe("skip");
    });
});

function deps(over: Partial<SweepDeps> = {}): SweepDeps & {
    removed: string[];
    listBlobs: ReturnType<typeof vi.fn>;
} {
    const removed: string[] = [];
    return {
        deployment: "local:me-tolaria",
        listBlobs: vi.fn(() => [old("a", 4), old("ref", 6)]),
        readKeys: async () => ({ kind: "keys", keys: new Set(["ref"]) }),
        removeBlob: (id) => void removed.push(id),
        now: () => NOW,
        removed,
        ...over,
    } as never;
}

describe("sweepBlobs", () => {
    it("deletes nothing without confirmation", async () => {
        const d = deps();
        const r = await sweepBlobs(d, false);
        expect(d.removed).toEqual([]);
        expect(r).toMatchObject({
            orphaned: 1,
            reclaimableBytes: 4,
            removed: 0,
        });
    });
    it("removes exactly the orphans with confirmation", async () => {
        const d = deps();
        const r = await sweepBlobs(d, true);
        expect(d.removed).toEqual(["a"]);
        expect(r).toMatchObject({ removed: 1, reclaimedBytes: 4 });
    });
    it("skips a cloud deployment with no filesystem access", async () => {
        const d = deps({ deployment: "dev:happy-animal-123" });
        const r = await sweepBlobs(d, true);
        expect(r).toMatchObject({ kind: "skipped" });
        expect(d.listBlobs).not.toHaveBeenCalled();
    });
    it("fails closed when no source-package key is found but blobs exist", async () => {
        const d = deps({
            readKeys: async () => ({ kind: "keys", keys: new Set() }),
        });
        expect(await sweepBlobs(d, true)).toMatchObject({ kind: "skipped" });
        expect(d.removed).toEqual([]);
    });
    it("skips when the database stays locked", async () => {
        const d = deps({
            readKeys: async () => ({ kind: "skip", reason: "locked" }),
        });
        expect(await sweepBlobs(d, true)).toEqual({
            kind: "skipped",
            reason: "locked",
        });
        expect(d.removed).toEqual([]);
    });
});

describe("runAutoSweep", () => {
    const report = {
        kind: "swept" as const,
        onDisk: 2,
        referenced: 1,
        orphaned: 1,
        reclaimableBytes: 4,
        removed: 1,
        reclaimedBytes: 4,
        retained: [],
    };
    it("is a no-op inside the window", async () => {
        const sweep = vi.fn();
        const stamp = vi.fn();
        await runAutoSweep({ due: () => false, sweep, stamp, log: vi.fn() });
        expect(sweep).not.toHaveBeenCalled();
        expect(stamp).not.toHaveBeenCalled();
    });
    it("advances the stamp only on a completed run", async () => {
        const stamp = vi.fn();
        await runAutoSweep({
            due: () => true,
            sweep: async () => ({ kind: "skipped", reason: "locked" }),
            stamp,
            log: vi.fn(),
        });
        expect(stamp).not.toHaveBeenCalled();
        await runAutoSweep({
            due: () => true,
            sweep: async () => report,
            stamp,
            log: vi.fn(),
        });
        expect(stamp).toHaveBeenCalledTimes(1);
    });
    it("swallows a sweeper that throws, leaving the stamp alone", async () => {
        const stamp = vi.fn();
        const log = vi.fn();
        await expect(
            runAutoSweep({
                due: () => true,
                sweep: async () => {
                    throw new Error("boom");
                },
                stamp,
                log,
            })
        ).resolves.toBeUndefined();
        expect(stamp).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    });
});
