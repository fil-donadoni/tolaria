// A local Convex backend that ANSWERS HTTP but cannot run a function (issue
// #9227). `reachable()` only proves a listener: on 2026-11-10 a backend four
// days old still answered, yet every mutation died with "Function execution
// timed out (maximum duration: 1s)", and `convex:ensure` rightly saw "up".
// The probe here times one trivial query round trip through the function
// runner; the heartbeat tick (every 10 min on both machines) restarts the
// service above the threshold, and records the deployment's sizes for a
// human to read (`runner status`).
import * as fs from "node:fs";
import * as path from "node:path";

/** A trivial query slower than this means a wedged function runner. A
 *  healthy local backend answers in tens of ms. */
export const WEDGE_THRESHOLD_MS = 5_000;

/** The probed function. It need not exist: the backend still resolves the
 *  path through its function runner and answers with an error, which is all
 *  the probe times. A wedge shows as no answer, or as the "timed out" error
 *  the backend itself raises. */
export const WEDGE_PROBE_PATH = "ensureProbe:ping";

export interface WedgeVerdict {
    wedged: boolean;
    ms: number;
    reason: string;
}

type FetchLike = (
    url: string,
    init: {
        method: string;
        headers: Record<string, string>;
        body: string;
        signal: AbortSignal;
    }
) => Promise<{ text(): Promise<string> }>;

/** Time one query round trip. Unreachable (refused, reset) is NOT a wedge:
 *  a down backend is `convex:ensure`'s ordinary job. */
export async function probeFunction(
    url: string,
    thresholdMs: number,
    fetchImpl: FetchLike = fetch as unknown as FetchLike,
    now: () => number = Date.now
): Promise<WedgeVerdict> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), thresholdMs);
    const start = now();
    try {
        const res = await fetchImpl(`${url.replace(/\/+$/, "")}/api/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path: WEDGE_PROBE_PATH,
                args: {},
                format: "json",
            }),
            signal: ctrl.signal,
        });
        const body = await res.text();
        const ms = now() - start;
        if (/timed out/i.test(body)) {
            return {
                wedged: true,
                ms,
                reason: "the backend reports a function timeout",
            };
        }
        if (ms >= thresholdMs) {
            return {
                wedged: true,
                ms,
                reason: `answered in ${ms} ms (threshold ${thresholdMs} ms)`,
            };
        }
        return { wedged: false, ms, reason: `answered in ${ms} ms` };
    } catch (e) {
        const ms = now() - start;
        if (ctrl.signal.aborted) {
            return {
                wedged: true,
                ms,
                reason: `no answer within ${thresholdMs} ms`,
            };
        }
        return {
            wedged: false,
            ms,
            reason: `unreachable (${(e as Error).message.split("\n")[0]})`,
        };
    } finally {
        clearTimeout(timer);
    }
}

// ── deployment sizes ────────────────────────────────────────────────────────

export interface DeploymentSizes {
    at: string;
    modulesBytes: number;
    sqliteBytes: number;
    /** From the last blob-gc report; `null` before any ran. */
    orphaned: number | null;
}

function dirBytes(dir: string): number {
    try {
        return fs
            .readdirSync(dir)
            .reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    } catch {
        return 0;
    }
}

function fileBytes(file: string): number {
    try {
        return fs.statSync(file).size;
    } catch {
        return 0;
    }
}

export function orphanRecordPath(root: string): string {
    return path.join(root, ".claude", "telemetry", "convex-orphans.json");
}

/** `convex:blob-gc` calls this after every report, so the heartbeat can show
 *  the orphan count without a database read of its own. */
export function recordOrphans(
    root: string,
    orphaned: number,
    now: number
): void {
    const file = orphanRecordPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
        file,
        JSON.stringify({ at: new Date(now).toISOString(), orphaned }) + "\n"
    );
}

function readOrphans(root: string): number | null {
    try {
        const v = JSON.parse(
            fs.readFileSync(orphanRecordPath(root), "utf8")
        ) as { orphaned?: unknown };
        return typeof v.orphaned === "number" ? v.orphaned : null;
    } catch {
        return null;
    }
}

/** Sizes of the local deployment under `root`: stat calls only. The sqlite
 *  figure includes its WAL and SHM, which is where an unbounded history shows. */
export function deploymentSizes(root: string, now: number): DeploymentSizes {
    const dir = path.join(root, ".convex", "local", "default");
    const db = path.join(dir, "convex_local_backend.sqlite3");
    return {
        at: new Date(now).toISOString(),
        modulesBytes: dirBytes(
            path.join(dir, "convex_local_storage", "modules")
        ),
        sqliteBytes:
            fileBytes(db) + fileBytes(`${db}-wal`) + fileBytes(`${db}-shm`),
        orphaned: readOrphans(root),
    };
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

/** The line `runner status` prints. */
export function sizesLine(s: DeploymentSizes): string {
    const orphans =
        s.orphaned === null
            ? "orphans not counted yet"
            : `${s.orphaned} orphaned blobs`;
    return `modules ${mb(s.modulesBytes)}, sqlite ${mb(s.sqliteBytes)}, ${orphans}`;
}
