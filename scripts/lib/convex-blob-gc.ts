/**
 * Orphaned source-package blobs of the LOCAL Convex deployment (issue #3186).
 *
 * Every `convex dev` push writes a few-MB blob under
 * `.convex/local/default/convex_local_storage/modules/` and the local backend
 * never collects the superseded ones: 4.9 GB / 864 blobs on 2026-09-08, 147 of
 * them still referenced. Everything here is pure or takes its I/O as an
 * argument, so the `node` vitest project (no `bun:sqlite`) can cover it; the
 * entry point `scripts/convex-blob-gc.ts` binds the real database and disk.
 *
 * LIVE iff the blob id appears as a `storageKey` on a `_source_packages`
 * document — a field that exists on no other table, so the test is exact.
 * Reclaiming the referenced blobs needs an export/wipe/re-push/import cycle
 * and is out of scope.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** A push writes the blob before the row that references it. */
export const MIN_BLOB_AGE_MS = 24 * 60 * 60 * 1000;
/** The automatic path runs at most this often. */
export const SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type BlobOnDisk = { id: string; bytes: number; mtimeMs: number };
export type Retained = { id: string; reason: string };
export type Classification = {
    removable: BlobOnDisk[];
    retained: Retained[];
    referenced: number;
    orphaned: number;
    reclaimableBytes: number;
};

/** Pure: which blobs may go, and why each of the others stays. */
export function classifyBlobs(
    onDisk: readonly BlobOnDisk[],
    referencedKeys: ReadonlySet<string>,
    now: number
): Classification {
    const removable: BlobOnDisk[] = [];
    const retained: Retained[] = [];
    let referenced = 0;
    for (const blob of onDisk) {
        if (referencedKeys.has(blob.id)) {
            referenced++;
            retained.push({
                id: blob.id,
                reason: "referenced by a source package",
            });
        } else if (now - blob.mtimeMs < MIN_BLOB_AGE_MS) {
            retained.push({
                id: blob.id,
                reason: "unreferenced but younger than 24h (a push may be in flight)",
            });
        } else removable.push(blob);
    }
    const orphaned = onDisk.length - referenced;
    return {
        removable,
        retained,
        referenced,
        orphaned,
        reclaimableBytes: removable.reduce((n, b) => n + b.bytes, 0),
    };
}

/** Whether the weekly automatic sweep is due; a missing or garbled stamp is due. */
export function sweepDue(stampPath: string, now: number): boolean {
    if (!existsSync(stampPath)) return true;
    const last = Number(readFileSync(stampPath, "utf8").trim());
    return !Number.isFinite(last) || now - last >= SWEEP_INTERVAL_MS;
}

export function writeSweepStamp(stampPath: string, now: number): void {
    writeFileSync(stampPath, `${now}\n`);
}

/** A sqlite error that a retry can outlast (the backend is writing). */
export function isTransientLock(err: unknown): boolean {
    return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(
        String((err as Error)?.message ?? err)
    );
}

export type ReadOutcome =
    | { kind: "keys"; keys: Set<string> }
    | { kind: "skip"; reason: string };

/** Retries a transient lock; exhausting the retries is a skip, not a throw. */
export async function readReferencedKeys(
    read: () => string[],
    opts: { attempts: number; sleep: (ms: number) => Promise<void> }
): Promise<ReadOutcome> {
    for (let i = 1; i <= opts.attempts; i++) {
        try {
            return { kind: "keys", keys: new Set(read()) };
        } catch (err) {
            if (!isTransientLock(err))
                return { kind: "skip", reason: `database unreadable: ${err}` };
            if (i < opts.attempts) await opts.sleep(500 * i);
        }
    }
    return {
        kind: "skip",
        reason: `database still locked after ${opts.attempts} attempts`,
    };
}

export type SweepDeps = {
    /** `CONVEX_DEPLOYMENT` as the checkout names it; `null` = unset. */
    deployment: string | null;
    listBlobs: () => BlobOnDisk[];
    readKeys: () => Promise<ReadOutcome>;
    removeBlob: (id: string) => void;
    now: () => number;
};
export type SweepReport =
    | { kind: "skipped"; reason: string }
    | {
          kind: "swept";
          onDisk: number;
          referenced: number;
          orphaned: number;
          reclaimableBytes: number;
          removed: number;
          reclaimedBytes: number;
          retained: Retained[];
      };

/** One sweep. Without `confirm` nothing is deleted. A cloud deployment never touches the disk. */
export async function sweepBlobs(
    deps: SweepDeps,
    confirm: boolean
): Promise<SweepReport> {
    if (!deps.deployment?.startsWith("local:"))
        return {
            kind: "skipped",
            reason: `only local deployments are swept (CONVEX_DEPLOYMENT=${deps.deployment ? deps.deployment.split(":")[0] : "unset"})`,
        };
    const keys = await deps.readKeys();
    if (keys.kind === "skip") return { kind: "skipped", reason: keys.reason };
    const blobs = deps.listBlobs();
    // Fail closed: no source package at all while blobs exist means a wrong or
    // unreadable database, never a deployment with nothing live.
    if (keys.keys.size === 0 && blobs.length > 0)
        return {
            kind: "skipped",
            reason: "no source-package keys found while blobs exist on disk",
        };
    const c = classifyBlobs(blobs, keys.keys, deps.now());
    let removed = 0;
    let reclaimedBytes = 0;
    if (confirm)
        for (const b of c.removable) {
            deps.removeBlob(b.id);
            removed++;
            reclaimedBytes += b.bytes;
        }
    return {
        kind: "swept",
        onDisk: c.referenced + c.orphaned,
        referenced: c.referenced,
        orphaned: c.orphaned,
        reclaimableBytes: c.reclaimableBytes,
        removed,
        reclaimedBytes,
        retained: c.retained,
    };
}

export type AutoDeps = {
    due: () => boolean;
    sweep: () => Promise<SweepReport>;
    stamp: () => void;
    log: (line: string) => void;
};

/**
 * The host-command hook: sweeps when due, advances the stamp only on a
 * completed sweep, and NEVER throws — the host keeps its own exit code.
 */
export async function runAutoSweep(deps: AutoDeps): Promise<void> {
    try {
        if (!deps.due()) return;
        const r = await deps.sweep();
        if (r.kind === "skipped") {
            deps.log(`convex-blob-gc: skipped — ${r.reason}`);
            return;
        }
        deps.stamp();
        deps.log(
            `convex-blob-gc: classified ${r.onDisk}, removed ${r.removed}, reclaimed ${r.reclaimedBytes} bytes`
        );
    } catch (err) {
        try {
            deps.log(`convex-blob-gc: failed (ignored) — ${err}`);
        } catch {
            /* the host command must not notice */
        }
    }
}
