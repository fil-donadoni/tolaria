#!/usr/bin/env bun
/**
 * `bun run convex:blob-gc` — report (and, with `--yes`, remove) the orphaned
 * source-package blobs of the local Convex deployment (issue #3186).
 *
 * SAFE BY DEFAULT: classifies and prints, deletes nothing. `--yes` removes
 * exactly the unreferenced blobs older than 24h. `--auto` is the form the
 * unattended loop driver runs at pass start: at most once per seven days
 * (stamp `.claude/telemetry/convex-blob-gc.stamp`), `--yes` implied, and it
 * ALWAYS exits 0 — a locked database, a missing deployment or an unreadable
 * directory is logged and the host carries on. Rules and why:
 * `scripts/lib/convex-blob-gc.ts`.
 */
import { Database } from "bun:sqlite";
import {
    existsSync,
    readdirSync,
    readFileSync,
    statSync,
    unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
    readReferencedKeys,
    runAutoSweep,
    sweepBlobs,
    sweepDue,
    writeSweepStamp,
    type SweepDeps,
} from "./lib/convex-blob-gc";
import { primaryCheckout } from "./lib/primary-checkout";

const root = primaryCheckout();
const deploymentDir = join(root, ".convex", "local", "default");
const dbPath = join(deploymentDir, "convex_local_backend.sqlite3");
const modulesDir = join(deploymentDir, "convex_local_storage", "modules");
const stampPath = join(root, ".claude", "telemetry", "convex-blob-gc.stamp");

function deploymentName(): string | null {
    if (process.env.CONVEX_DEPLOYMENT) return process.env.CONVEX_DEPLOYMENT;
    try {
        const env = join(root, ".env.local");
        if (!existsSync(env)) return null;
        const m = /^\s*CONVEX_DEPLOYMENT\s*=\s*["']?([^"'\s#]+)/m.exec(
            readFileSync(env, "utf8")
        );
        return m?.[1] ?? null;
    } catch {
        return null; // unreadable env file: sweepBlobs skips, stating why
    }
}

/** Read-only, busy timeout: the backend is running while this reads. */
function readStorageKeys(): string[] {
    const db = new Database(dbPath, { readonly: true });
    try {
        db.exec("PRAGMA busy_timeout = 20000");
        return db
            .query(
                "SELECT DISTINCT json_extract(json_value, '$.storageKey') AS k FROM documents WHERE json_value LIKE '%storageKey%'"
            )
            .all()
            .map((r) => (r as { k: unknown }).k)
            .filter((k): k is string => typeof k === "string");
    } finally {
        db.close();
    }
}

const deps: SweepDeps = {
    deployment: deploymentName(),
    listBlobs: () =>
        readdirSync(modulesDir)
            .filter((f) => f.endsWith(".blob"))
            .map((f) => {
                const s = statSync(join(modulesDir, f));
                return {
                    id: f.slice(0, -5),
                    bytes: s.size,
                    mtimeMs: s.mtimeMs,
                };
            }),
    readKeys: () =>
        readReferencedKeys(readStorageKeys, {
            attempts: 5,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        }),
    removeBlob: (id) => unlinkSync(join(modulesDir, `${id}.blob`)),
    now: Date.now,
};

if (process.argv.includes("--auto")) {
    await runAutoSweep({
        due: () => sweepDue(stampPath, Date.now()),
        sweep: () => sweepBlobs(deps, true),
        stamp: () => writeSweepStamp(stampPath, Date.now()),
        log: (line) => console.error(line),
    }).catch(() => {});
    process.exit(0);
}

const confirm = process.argv.includes("--yes");
const r = await sweepBlobs(deps, confirm);
if (r.kind === "skipped") {
    console.log(`convex:blob-gc: skipped — ${r.reason}`);
    process.exit(0);
}
const mb = (n: number) => (n / 1e6).toFixed(1);
console.log(
    `convex:blob-gc: ${r.onDisk} on disk, ${r.referenced} referenced, ${r.orphaned} orphaned, ${mb(r.reclaimableBytes)} MB reclaimable`
);
console.log(
    confirm
        ? `convex:blob-gc: removed ${r.removed} blobs, reclaimed ${mb(r.reclaimedBytes)} MB`
        : "convex:blob-gc: report only — pass --yes to remove"
);
