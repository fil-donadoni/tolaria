/**
 * The Bot Findings refresh and the Bot audits, owed NIGHTLY (ADR 0141 § 5,
 * issue #4181; moved out of the health batch by issue #5458).
 *
 * The admin page's measurement (`data/bot-reach-findings.json`) is re-taken by
 * `bun run health:nightly` (`scripts/health-nightly.ts`, a cron entry point),
 * and ONLY when the base moved the Bot's globs since the last nightly refresh —
 * `land`, `check:pr` and the health batch never pay it (265 s of CPU on a
 * shared machine), and a night that left the Bot alone would re-measure
 * verdicts it cannot have moved. The blade robustness and held-out pick
 * agreement audits ride the same entry point WEEKLY (`auditsDue`). None of it
 * is a gate: health proves the tree, this keeps a view of the Bot fresh.
 *
 * This module is the DECISION and the steps; `health-nightly.ts` runs them.
 * Node builtins and `bot-globs.ts` (itself import-free) only.
 */
import { touchesBotGlobs } from "./bot-globs";
import type { HealthStep } from "./health-step";

/** Where the refreshed artifact is kept for whoever commits it: the primary
 *  checkout's health dir, beside `last.json`. */
export const REFRESHED_ARTIFACT_NAME = "bot-reach-findings.json";

/** The nightly's own record, beside `last.json`: what it last measured and
 *  audited, so the next night knows what moved. */
export const NIGHTLY_RECORD_FILE = "nightly.json";

export interface NightlyRecord {
    /** The base tip the last SUCCESSFUL refresh measured. */
    refreshedSha: string | null;
    /** The measured tip whose Bot Gaps `gaps:sync` last filed. */
    filedSha: string | null;
    /** Epoch ms of the last audit run the nightly started. */
    auditedAt: number | null;
}

export const EMPTY_NIGHTLY: NightlyRecord = {
    refreshedSha: null,
    filedSha: null,
    auditedAt: null,
};

/** The day of the week (`Date.getDay()`, local time, 0 = Sunday) the audits
 *  run on: the weekend night, when no session is landing. */
export const AUDIT_WEEKDAY = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Did the base move the Bot? `changed` is the repo-relative paths between the
 * last refreshed tip and this one, or `null` when that diff could not be taken
 * (no refresh recorded, or it is no longer reachable): an unknown diff
 * measures — the artifact's own cache makes an untouched Bot cost seconds, and
 * a page silently left stale is the failure this exists to prevent.
 */
export function batchTouchesBot(changed: readonly string[] | null): boolean {
    return changed === null || touchesBotGlobs(changed);
}

/**
 * Are the weekly audits owed tonight? On `AUDIT_WEEKDAY` unless they already
 * ran within the day (a cron re-fired, a by-hand run), and on ANY night once
 * the last audit is more than a week and a day old — a machine asleep on the
 * weekly night slips the audit by a day, never by a week. `force` is the
 * by-hand `--audits`.
 */
export function auditsDue(input: {
    now: Date;
    lastAuditAt: number | null;
    weekday?: number;
    force?: boolean;
}): { due: boolean; reason: string } {
    const { now, lastAuditAt, weekday = AUDIT_WEEKDAY, force } = input;
    if (force) return { due: true, reason: "asked for (--audits)" };
    const age = lastAuditAt === null ? null : now.getTime() - lastAuditAt;
    if (age !== null && age > 8 * DAY_MS)
        return {
            due: true,
            reason: `last audit ${Math.floor(age / DAY_MS)} days ago — the weekly night was missed`,
        };
    if (now.getDay() !== weekday)
        return { due: false, reason: "not the weekly audit night" };
    if (age !== null && age < DAY_MS)
        return { due: false, reason: "already audited within the day" };
    return { due: true, reason: "the weekly audit night" };
}

/** The step that FILES Bot Gaps (issue #4944) — `land`'s post-merge
 *  `gaps:sync` files them too (issue #5301). Not a refresh step: failing it
 *  leaves the page fresh. */
export const FILING_STEP_NAME = "gaps:sync";

/**
 * The three steps of a refresh, numbered after the `gates` already planned
 * (the nightly's own bootstrap):
 * re-measure, seed the deployment from the artifact just written, then file the
 * Bot Gaps the committed findings carry (issue #4944, ADR 0146 — one sweep adds
 * at most one issue per family, through the Cluster Signatures).
 *
 * `gaps:sync` runs in `primary` — historically the PRIMARY checkout; since
 * issue #5873 the nightly passes a throwaway worktree at the measured tip, from
 * which the script commits and pushes the allowlist (`push origin HEAD:<base>`
 * needs no branch checked out). A health batch still passes its primary.
 *
 * `bot:reach` goes through the heavy gate like every CPU-bound step: it queues
 * on the mutex instead of racing a `land` or a health run.
 */
export function botRefreshSteps(
    gates: number,
    primary: string = process.cwd()
): HealthStep[] {
    const total = gates + 3;
    return [
        {
            ordinal: gates + 1,
            total,
            name: "bot:reach",
            cmd: "bun",
            args: ["scripts/gate.ts", "heavy", "bun run bot:reach"],
        },
        {
            ordinal: gates + 2,
            total,
            name: "seed:bot-findings",
            cmd: "bun",
            args: ["run", "seed:bot-findings"],
        },
        {
            ordinal: gates + 3,
            total,
            name: FILING_STEP_NAME,
            cmd: "bun",
            args: ["run", "gaps:sync"],
            cwd: primary,
        },
    ];
}
