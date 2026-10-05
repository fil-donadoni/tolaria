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
 *   - `health-cadence` spawns `health-robustness-audit.ts` detached once the
 *     verdict is GREEN or RED, at the `yield` admission class, on the same tip;
 *   - the audit claims the request (`claimAuditRequest`), runs, files drift
 *     (`robustnessOutcome` / `fileDriftIssues`, unchanged) and leaves ONE
 *     record (`AUDIT_RECORD_FILE`) that `health:status` shows.
 *
 * The audit NEVER writes `last.json` or the RED marker: it is handed the
 * health directory only to read the verdict it must follow and to write its
 * own record. A `wrong` it sees is reported in the record; the RED for that
 * tip comes from `test:blade`. `release` does not wait for it.
 *
 * Node builtins, `health-robustness-drift.ts` and `health-robustness-trigger.ts`
 * (types and `robustnessStepEnv` only) — `health-main.ts`'s own constraint.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** What `health-main` leaves for the audit, beside `last.json`: one file per
 *  tip, so a later run never deletes or overwrites an earlier tip's request. */
export function auditRequestFile(sha: string): string {
    return `robustness-request-${sha.slice(0, 12)}.json`;
}

/** What the audit leaves for `health:status`, beside `last.json`. */
export const AUDIT_RECORD_FILE = "robustness-audit.json";

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

export function readAuditRecord(dir: string): AuditRecord | null {
    try {
        return JSON.parse(
            readFileSync(join(dir, AUDIT_RECORD_FILE), "utf8")
        ) as AuditRecord;
    } catch {
        return null;
    }
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
    request: AuditRequest;
    log: string;
    run: (request: AuditRequest) => Promise<AuditStepResult>;
    file?: (issues: readonly DriftIssue[]) => string[];
    now?: () => Date;
}): Promise<AuditRecord> {
    const { dir, request, log, run } = opts;
    const file = opts.file ?? fileDriftIssues;
    const now = opts.now ?? (() => new Date());
    const base = {
        sha: request.sha,
        mode: request.mode,
        startedAt: now().toISOString(),
        pid: process.pid,
        log,
    };
    const write = (record: AuditRecord): AuditRecord => {
        writeFileSync(
            join(dir, AUDIT_RECORD_FILE),
            JSON.stringify(record, null, 2)
        );
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

/** The `health:status` line for the last audit. `alive` says whether the
 *  record's pid still runs (a `running` record whose process died is
 *  abandoned, not in progress). */
export function describeAuditRecord(
    record: AuditRecord,
    alive: boolean = true
): string {
    const filed =
        record.filed.length > 0 ? ` — ${record.filed.join("; ")}` : "";
    const wrong =
        record.wrong && record.wrong.length > 0
            ? ` — fails its own seeds (test:blade reds the tip): ${record.wrong.join(", ")}`
            : "";
    const status =
        record.status === "running" && !alive ? "abandoned" : record.status;
    return `${status} @ ${record.sha.slice(0, 8)} (${record.mode})${wrong}${filed}`;
}
