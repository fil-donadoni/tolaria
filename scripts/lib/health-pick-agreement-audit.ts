/**
 * Held-out pick agreement as a POST-VERDICT health audit (issue #3982, PRD
 * #3980, ADR 0138, ADR 0143).
 *
 * `bun run verdicts:pick-agreement` replays the held-out Verdicts through the
 * real search (`searchHeldOutVerdicts`) — minutes of CPU, a strength reading
 * that gates nothing in v1. So it follows the blade robustness audit's shape
 * (`health-robustness-audit.ts`, issue #5079), not a member of
 * `HEALTH_SCRIPTS`:
 *
 *   - `health-main` writes a REQUEST (`writePickRequest`) when the batch can
 *     have moved the Bot (the same trigger as the blade audit: Bot hash
 *     inputs changed) — the mode, nothing else;
 *   - `health-cadence` spawns `health-pick-agreement-audit.ts` detached once
 *     the verdict is GREEN or RED, at the `yield` admission class;
 *   - the audit claims the request, runs, and leaves ONE record
 *     (`PICK_RECORD_FILE`) that `health:status` shows.
 *
 * It NEVER writes `last.json` or the RED marker, and a failure of the step is
 * a record (`failed` / `infra`), never a red tip.
 *
 * Node builtins only — `health-main.ts`'s own constraint.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditStepResult, VerdictRecord } from "./health-robustness-audit";

/** The package script the audit runs. */
export const PICK_AGREEMENT_STEP = "verdicts:pick-agreement";

/** First line of the block `formatHeldOutPickAgreement` prints. */
export const PICK_REPORT_HEADER = "== held-out pick agreement";

/** What `health-main` leaves for the audit, beside `last.json`: one file per
 *  tip. */
export function pickRequestFile(sha: string): string {
    return `pick-agreement-request-${sha.slice(0, 12)}.json`;
}

/** What the audit leaves for `health:status`, beside `last.json`. */
export const PICK_RECORD_FILE = "pick-agreement.json";

export interface PickRequest {
    /** The tip the audit runs on — the tip the health verdict is about. */
    sha: string;
    /** Why it is owed, for the record. */
    reason: string;
}

export type PickStatus =
    /** The step ran and printed its report. */
    | "measured"
    /** The step failed with no machine excuse; nothing gated. */
    | "failed"
    /** The machine cut the audit short. */
    | "infra"
    | "running";

export interface PickRecord {
    sha: string;
    status: PickStatus;
    reason: string;
    startedAt: string;
    finishedAt?: string;
    pid?: number;
    /** `measured` only: the report's summary block (header, aggregate, per
     *  class), as printed. */
    summary: string[];
    log?: string;
}

/** Leave the request for the verdict's reader; a batch that owes nothing
 *  removes this tip's own. */
export function writePickRequest(
    dir: string,
    sha: string,
    reason: string,
    owed: boolean
): void {
    const file = join(dir, pickRequestFile(sha));
    if (!owed) {
        rmSync(file, { force: true });
        return;
    }
    const request: PickRequest = { sha, reason };
    writeFileSync(file, JSON.stringify(request, null, 2));
}

/** The request for tip `sha`, once the verdict for that SAME tip is GREEN or
 *  RED, or `null`. Read-only. */
export function readOwedPick(
    dir: string,
    sha: string,
    last: VerdictRecord | null
): PickRequest | null {
    const file = join(dir, pickRequestFile(sha));
    if (!existsSync(file) || last === null || last.sha !== sha) return null;
    if (last.status !== "green" && last.status !== "red") return null;
    try {
        const request = JSON.parse(readFileSync(file, "utf8")) as PickRequest;
        return request.sha === sha ? request : null;
    } catch {
        return null;
    }
}

/** Take the request for `sha`, then delete it, so two detached decisions never
 *  audit the same tip twice. */
export function claimPickRequest(
    dir: string,
    sha: string,
    last: VerdictRecord | null
): PickRequest | null {
    const request = readOwedPick(dir, sha, last);
    if (request !== null)
        rmSync(join(dir, pickRequestFile(sha)), { force: true });
    return request;
}

export function readPickRecord(dir: string): PickRecord | null {
    try {
        return JSON.parse(
            readFileSync(join(dir, PICK_RECORD_FILE), "utf8")
        ) as PickRecord;
    } catch {
        return null;
    }
}

/** The report block out of the step's output: the header line and the
 *  indented lines under it, up to the first line that is not one. */
export function extractPickSummary(output: string): string[] {
    // eslint-disable-next-line no-control-regex
    const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    const at = lines.findIndex((l) => l.startsWith(PICK_REPORT_HEADER));
    if (at < 0) return [];
    const out = [lines[at]];
    for (const line of lines.slice(at + 1)) {
        if (!line.startsWith("  ")) break;
        out.push(line);
    }
    return out;
}

/**
 * Run the audit for a claimed request and record the outcome. The verdict
 * files (`last.json`, `RED`) are not parameters: nothing here can write them.
 */
export async function runPickAudit(opts: {
    dir: string;
    request: PickRequest;
    log: string;
    run: (request: PickRequest) => Promise<AuditStepResult>;
    now?: () => Date;
}): Promise<PickRecord> {
    const { dir, request, log, run } = opts;
    const now = opts.now ?? (() => new Date());
    const base = {
        sha: request.sha,
        reason: request.reason,
        startedAt: now().toISOString(),
        pid: process.pid,
        log,
    };
    const write = (record: PickRecord): PickRecord => {
        writeFileSync(
            join(dir, PICK_RECORD_FILE),
            JSON.stringify(record, null, 2)
        );
        return record;
    };
    write({ ...base, status: "running", summary: [] });

    const result = await run(request);
    const finishedAt = now().toISOString();
    if (result.excused)
        return write({ ...base, status: "infra", finishedAt, summary: [] });
    const summary = extractPickSummary(result.output);
    // A zero exit that printed no report measured nothing.
    if (!result.ok || summary.length === 0)
        return write({ ...base, status: "failed", finishedAt, summary: [] });
    return write({ ...base, status: "measured", finishedAt, summary });
}

/** The `health:status` text for the last audit. */
export function describePickRecord(
    record: PickRecord,
    alive: boolean = true
): string {
    const status =
        record.status === "running" && !alive ? "abandoned" : record.status;
    const head = `${status} @ ${record.sha.slice(0, 8)} (${record.reason})`;
    return [head, ...record.summary.map((l) => `    ${l.trim()}`)].join("\n");
}
