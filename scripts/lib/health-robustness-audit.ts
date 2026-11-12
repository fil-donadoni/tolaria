/**
 * The blade robustness audit as a POST-VERDICT drift filer (issue #5079).
 *
 * `blade:robustness` (issue #4875) used to be an offline gate of the health
 * run, ~16 min under the heavy mutex. Since issue #5016 it can red the tip
 * only on `wrong` — an entry failing its OWN seeds — and that is exactly what
 * `test:blade` runs in every health run: `auditBladeScenario`'s own leg is
 * `runBladeScenario(scenario)` over `bladeScenariosForTier("must")` at the
 * entry's own budget and seeds with no variant, and the must suite's runner
 * (`bladeShardRunner.helper.ts`) is `runBladeScenario(scenario, VARIANT)` over
 * the same entries with `VARIANT` null in health. Same entries, seeds, weights
 * and budget — so as a gate the audit added mutex time and no verdict.
 *
 * What is left of it is the drift it files (noise-pinned entries, stale
 * baseline rows), and that belongs AFTER the verdict:
 *
 *   - `health-main` writes a REQUEST (`writeAuditRequest`) when the batch owes
 *     the audit (`robustnessOwed`) — the mode, nothing else;
 *   - `health-nightly` runs `health-robustness-audit.ts` once the verdict is
 *     GREEN or RED, at the `yield` admission class, on the same tip;
 *   - the audit claims the request (`claimAuditRequest`), runs, files drift
 *     (`robustnessOutcome` / `fileDriftIssues`, unchanged) and leaves ONE
 *     record that `health:status` shows.
 *
 * The record is SHARED state (issue #9294: the `robustness` key of
 * `refs/tolaria/state`, `lib/shared-state.ts`), like the nightly record it
 * runs under (issue #5873): the audit runs on whichever `maint` runner is
 * free, so a machine-local file showed each machine its OWN last audit,
 * however old, as current. A `robustness-audit.json` beside `last.json` from
 * before is read once, as the first shared record, when the ref holds none.
 * The status line states the record's age and flags one older than the
 * weekly cadence allows (`AUDIT_STALE_DAYS`).
 *
 * The audit NEVER writes `last.json` or the RED marker: it is handed the
 * health directory only to read the verdict it must follow and to write its
 * own record. A `wrong` it sees is reported in the record; the RED for that
 * tip comes from `test:blade`. `release` does not wait for it.
 *
 * Node builtins, `health-robustness-drift.ts`, `health-robustness-trigger.ts`
 * (types and `robustnessStepEnv` only) and `shared-state.ts` (Node builtins
 * only) — `health-main.ts`'s own constraint.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
    fileDriftIssues,
    robustnessOutcome,
    type DriftIssue,
} from "./health-robustness-drift";
import {
    describeRobustnessMode,
    robustnessStepEnv,
    type RobustnessMode,
} from "./health-robustness-trigger";
import {
    readSharedState,
    realGit,
    SharedStateConflict,
    writeSharedState,
    type GitRunner,
    type SharedRead,
} from "./shared-state";

/** What `health-main` leaves for the audit, beside `last.json`: one file per
 *  tip, so a later run never deletes or overwrites an earlier tip's request. */
export function auditRequestFile(sha: string): string {
    return `robustness-request-${sha.slice(0, 12)}.json`;
}

/** Where the audit left its record before issue #9294, beside `last.json`:
 *  read once, as the first shared record, when the ref holds none. */
export const AUDIT_RECORD_FILE = "robustness-audit.json";

/** The shared-state key of the audit record (issue #9294). */
export const AUDIT_RECORD_KEY = "robustness";

/** The audit is owed weekly; a newest record older than this is stale. */
export const AUDIT_STALE_DAYS = 8;

export interface AuditRequest {
    /** The tip the audit runs on — the tip the health verdict is about. */
    sha: string;
    /** `describeRobustnessMode`'s text, for the record. */
    mode: string;
    /** Extra env for the audit step (`BLADE_ROBUSTNESS_LABELS`). */
    env?: Record<string, string>;
}

export type AuditStatus =
    /** The audit ran clean. */
    | "clean"
    /** Drift found and filed (or already filed); the tip's verdict untouched. */
    | "drift"
    /** An entry fails its own seeds. Reported only: `test:blade` reds the tip. */
    | "wrong"
    /** The machine cut the audit short; nothing was filed. */
    | "infra"
    | "running";

export interface AuditRecord {
    sha: string;
    status: AuditStatus;
    mode: string;
    startedAt: string;
    finishedAt?: string;
    /** The audit process: a `running` record whose pid is dead was killed. */
    pid?: number;
    /** `os.hostname()` of the machine that ran it: `pid` means something
     *  only there. */
    machine?: string;
    /** `fileDriftIssues`'s report lines. */
    filed: string[];
    /** `wrong` only: the entries that fail their own seeds. */
    wrong?: string[];
    /** The audit's output, on disk. */
    log?: string;
}

/** The verdict records the audit follows: it only runs once one is written. */
export interface VerdictRecord {
    sha: string;
    status: string;
}

/** Leave the request for the verdict's reader; a batch that owes nothing
 *  removes this tip's own (a re-gate of the same tip that no longer owes it). */
export function writeAuditRequest(
    dir: string,
    sha: string,
    mode: RobustnessMode,
    owed: boolean
): void {
    const file = join(dir, auditRequestFile(sha));
    if (!owed) {
        rmSync(file, { force: true });
        return;
    }
    const env = robustnessStepEnv(mode);
    const request: AuditRequest = {
        sha,
        mode: describeRobustnessMode(mode),
        ...(env ? { env } : {}),
    };
    writeFileSync(file, JSON.stringify(request, null, 2));
}

/** The request for tip `sha`, once the verdict for that SAME tip is GREEN or
 *  RED, or `null`. Read-only. */
export function readOwedAudit(
    dir: string,
    sha: string,
    last: VerdictRecord | null
): AuditRequest | null {
    const file = join(dir, auditRequestFile(sha));
    if (!existsSync(file) || last === null || last.sha !== sha) return null;
    if (last.status !== "green" && last.status !== "red") return null;
    try {
        const request = JSON.parse(readFileSync(file, "utf8")) as AuditRequest;
        return request.sha === sha ? request : null;
    } catch {
        return null;
    }
}

/** Take the request for `sha`: `readOwedAudit`, then delete it, so two
 *  detached decisions never audit the same tip twice. */
export function claimAuditRequest(
    dir: string,
    sha: string,
    last: VerdictRecord | null
): AuditRequest | null {
    const request = readOwedAudit(dir, sha, last);
    if (request !== null)
        rmSync(join(dir, auditRequestFile(sha)), { force: true });
    return request;
}

/** The audit record's store: the shared ref, injectable for tests. `read`
 *  throws when origin does not answer; `write` throws `SharedStateConflict`
 *  when the ref moved since `expected` was read. */
export interface AuditRecordStore {
    read(): SharedRead;
    write(raw: string, expected: string | null): string;
}

export function sharedAuditStore(
    root: string,
    git: GitRunner = realGit
): AuditRecordStore {
    return {
        read: () => readSharedState(root, AUDIT_RECORD_KEY, git),
        write: (raw, expected) =>
            writeSharedState(root, AUDIT_RECORD_KEY, raw, expected, git),
    };
}

function parseAuditRecord(raw: string): AuditRecord | null {
    try {
        return JSON.parse(raw) as AuditRecord;
    } catch {
        return null;
    }
}

/** The shared record and the ref sha it was read at (the lease of the next
 *  write); the local file of a machine from before issue #9294 when the ref
 *  holds none. Throws when origin does not answer. */
export function readAuditRecord(
    store: AuditRecordStore,
    dir: string
): { record: AuditRecord | null; lease: string | null } {
    const shared = store.read();
    if (shared.raw !== null)
        return { record: parseAuditRecord(shared.raw), lease: shared.sha };
    let local: string;
    try {
        local = readFileSync(join(dir, AUDIT_RECORD_FILE), "utf8");
    } catch {
        return { record: null, lease: shared.sha };
    }
    return { record: parseAuditRecord(local), lease: shared.sha };
}

/** What one audit run reports back: the step's own result. */
export interface AuditStepResult {
    ok: boolean;
    output: string;
    /** The machine explains the failure (`infraCause`): file nothing. */
    excused: boolean;
}

/**
 * Run the audit for a claimed request and record the outcome. The verdict
 * files (`last.json`, `RED`) are not parameters: nothing here can write them.
 */
export async function runAudit(opts: {
    dir: string;
    store: AuditRecordStore;
    request: AuditRequest;
    log: string;
    run: (request: AuditRequest) => Promise<AuditStepResult>;
    file?: (issues: readonly DriftIssue[]) => string[];
    now?: () => Date;
}): Promise<AuditRecord> {
    const { dir, store, request, log, run } = opts;
    const file = opts.file ?? fileDriftIssues;
    const now = opts.now ?? (() => new Date());
    const base = {
        sha: request.sha,
        mode: request.mode,
        startedAt: now().toISOString(),
        pid: process.pid,
        machine: hostname(),
        log,
    };
    let lease: string | null = null;
    try {
        lease = readAuditRecord(store, dir).lease;
    } catch (err) {
        console.error(
            `health-robustness-audit: could not read the shared record — ${(err as Error).message}`
        );
    }
    const write = (record: AuditRecord): AuditRecord => {
        writeAuditRecord(store, dir, record, lease, (sha) => (lease = sha));
        return record;
    };
    write({ ...base, status: "running", filed: [] });

    const result = await run(request);
    const finishedAt = now().toISOString();
    if (result.ok)
        return write({ ...base, status: "clean", finishedAt, filed: [] });
    if (result.excused)
        return write({ ...base, status: "infra", finishedAt, filed: [] });

    const outcome = robustnessOutcome(result.output, {
        sha: request.sha,
        log,
    });
    if (outcome.verdict === "red")
        return write({
            ...base,
            status: "wrong",
            finishedAt,
            filed: [],
            wrong: outcome.wrong,
        });
    return write({
        ...base,
        status: "drift",
        finishedAt,
        filed: file(outcome.issues),
    });
}

/** Compare-and-swap on the ref. A conflict re-reads once: a record that
 *  STARTED later than this one (another machine's newer audit) is kept,
 *  otherwise this one is written over it. A failed write is said, never
 *  thrown — the audit's drift is already filed. */
function writeAuditRecord(
    store: AuditRecordStore,
    dir: string,
    record: AuditRecord,
    lease: string | null,
    setLease: (sha: string) => void
): void {
    const raw = JSON.stringify(record, null, 2);
    try {
        try {
            setLease(store.write(raw, lease));
            return;
        } catch (err) {
            if (!(err instanceof SharedStateConflict)) throw err;
        }
        const current = readAuditRecord(store, dir);
        if (
            current.record !== null &&
            current.record.startedAt > record.startedAt
        ) {
            console.error(
                `health-robustness-audit: a newer audit's record (${current.record.status} @ ${current.record.sha.slice(0, 8)}) stands — this ${record.status} record is not written`
            );
            return;
        }
        setLease(store.write(raw, current.lease));
    } catch (err) {
        console.error(
            `health-robustness-audit: could not write the shared record — ${(err as Error).message}`
        );
    }
}

/** `" — 2026-10-11 on macbook, 32 d ago"`, then the stale flag when the
 *  record is older than `AUDIT_STALE_DAYS`. Pure. */
function describeAge(record: AuditRecord, now: Date): string {
    const at = record.finishedAt ?? record.startedAt;
    const ms = Date.parse(at);
    const on = record.machine ? ` on ${record.machine}` : "";
    if (Number.isNaN(ms)) return ` — recorded at an unknown time${on}`;
    const ageMs = now.getTime() - ms;
    const days = Math.floor(ageMs / 86_400_000);
    const stale =
        ageMs > AUDIT_STALE_DAYS * 86_400_000
            ? ` — STALE: older than ${AUDIT_STALE_DAYS} d, the weekly audit has not run since`
            : "";
    return ` — ${at.slice(0, 10)}${on}, ${days} d ago${stale}`;
}

/** The `health:status` line for the last audit. `alive` says whether the
 *  record's pid still runs (a `running` record whose process died is
 *  abandoned, not in progress). The record's date and age always show, so a
 *  month-old verdict never reads as current (issue #9294). */
export function describeAuditRecord(
    record: AuditRecord,
    alive: boolean = true,
    now: Date = new Date()
): string {
    const filed =
        record.filed.length > 0 ? ` — ${record.filed.join("; ")}` : "";
    const wrong =
        record.wrong && record.wrong.length > 0
            ? ` — fails its own seeds (test:blade reds the tip): ${record.wrong.join(", ")}`
            : "";
    const status =
        record.status === "running" && !alive ? "abandoned" : record.status;
    return `${status} @ ${record.sha.slice(0, 8)} (${record.mode})${describeAge(record, now)}${wrong}${filed}`;
}
