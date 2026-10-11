#!/usr/bin/env bun
/**
 * The nightly Bot upkeep — a cron entry point (issue #5458).
 *
 *   bun run health:nightly            # refresh if the Bot moved; audits if due
 *   bun run health:nightly --audits   # and the weekly audits, whatever the day
 *
 * What used to ride the health batch and proves nothing about the tree:
 *
 *   - NIGHTLY, the Bot Findings refresh (ADR 0141 § 5): `bot:reach`,
 *     `seed:bot-findings`, then `gaps:sync` — only when the base moved the
 *     Bot's globs since the last successful refresh (`batchTouchesBot`). It
 *     measures the CURRENT `origin/<base>` tip, in a throwaway worktree.
 *   - WEEKLY (`auditsDue`), the blade robustness audit (issue #4875) and the
 *     held-out pick agreement audit (issue #3982), each in FULL, on the tip
 *     the last health verdict is about — the audit scripts follow a GREEN or
 *     RED record and never write one (`lib/health-robustness-audit.ts`).
 *
 * Neither can red a tip or write the RED marker: a failed refresh leaves the
 * page stale, a failed audit leaves its own record. Every CPU-bound step goes
 * through `gate.ts` (`heavy` for `bot:reach`, `yield` for the audits), so the
 * cron queues behind a `land` or a health run instead of racing it. Exit 1
 * when a step failed, so the cron's log says so; 0 otherwise.
 *
 * Its record (`nightly.json`, beside `last.json`) is what the next night
 * reads: the tip last measured, when the audits last ran.
 */
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { HEALTH_ROLE } from "./lib/gate-liveness";
import {
    auditsDue,
    batchTouchesBot,
    botRefreshSteps,
    EMPTY_NIGHTLY,
    FILING_STEP_NAME,
    NIGHTLY_RECORD_FILE,
    REFRESHED_ARTIFACT_NAME,
    type NightlyRecord,
} from "./lib/health-bot-refresh";
import { writePickRequest } from "./lib/health-pick-agreement-audit";
import { writeAuditRequest } from "./lib/health-robustness-audit";
import {
    healthGateEnv,
    healthStepArgs,
    runHealthStep,
    WALK_BOOTSTRAP,
} from "./lib/health-step";
import { primaryCheckout } from "./lib/primary-checkout";

const HEALTH_DIR = join(".claude", "telemetry", "health");
const GATE = resolve(__dirname, "gate.ts");
const ROBUSTNESS_AUDIT = resolve(__dirname, "health-robustness-audit.ts");
const PICK_AGREEMENT_AUDIT = resolve(
    __dirname,
    "health-pick-agreement-audit.ts"
);

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

function readRecord(dir: string): NightlyRecord {
    try {
        return {
            ...EMPTY_NIGHTLY,
            ...(JSON.parse(
                readFileSync(join(dir, NIGHTLY_RECORD_FILE), "utf8")
            ) as Partial<NightlyRecord>),
        };
    } catch {
        return { ...EMPTY_NIGHTLY };
    }
}

/** Atomic, like the cadence ledger: a reader sees one whole version. */
function writeRecord(dir: string, record: NightlyRecord): void {
    const tmp = join(dir, `${NIGHTLY_RECORD_FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(record, null, 2));
    renameSync(tmp, join(dir, NIGHTLY_RECORD_FILE));
}

/** Paths changed between the last refreshed tip and `tip`, or `null` when
 *  that diff cannot be taken — an unknown diff measures. */
function changedSince(
    root: string,
    from: string | null,
    tip: string
): string[] | null {
    if (from === null) return null;
    const r = spawnSync("git", ["diff", "--name-only", `${from}..${tip}`], {
        encoding: "utf8",
        cwd: root,
    });
    if (r.status !== 0) return null;
    return r.stdout.split("\n").filter((line) => line !== "");
}

/** The Bot Findings refresh on `tip`: true when the page was re-measured
 *  (filing may still have been skipped or failed — it is no part of it). */
async function refresh(root: string, dir: string, tip: string) {
    const wt = join(root, "..", `tolaria-nightly-${process.pid}`);
    const logPath = join(dir, `${tip.slice(0, 12)}.nightly.log`);
    const env = healthGateEnv(process.env);
    let refreshed = false;
    try {
        git(["worktree", "add", "--detach", wt, tip], root);
        const steps = botRefreshSteps(1, root);
        const boot = await runHealthStep(
            {
                ordinal: 1,
                total: steps[0]!.total,
                name: WALK_BOOTSTRAP,
                cmd: "bun",
                args: healthStepArgs(WALK_BOOTSTRAP),
            },
            { cwd: wt, env, logPath }
        );
        if (!boot.ok) {
            console.error(
                `health-nightly: ${WALK_BOOTSTRAP} failed — Bot Findings stay stale (${logPath})`
            );
            return false;
        }
        for (const step of steps) {
            if (step.name === FILING_STEP_NAME) {
                // The page is measured: whatever filing does, it is fresh.
                refreshed = true;
                // Filing commits and pushes the allowlist from the primary
                // checkout and reads ITS tree: only when that tree is the
                // measured tip (issue #4944). Otherwise the next night files.
                if (git(["rev-parse", "HEAD"], root) !== tip) {
                    console.error(
                        `health-nightly: ${step.name} skipped — the primary checkout is not at the measured tip ${tip.slice(0, 12)}; Bot Gaps file next night`
                    );
                    break;
                }
            }
            const r = await runHealthStep(step, {
                cwd: step.cwd ?? wt,
                env,
                logPath,
            });
            if (!r.ok) {
                console.error(
                    step.name === FILING_STEP_NAME
                        ? `health-nightly: ${step.name} failed — Bot Gaps not filed tonight (${logPath})`
                        : `health-nightly: ${step.name} failed — Bot Findings stay stale (${logPath})`
                );
                break;
            }
        }
        // Kept beside `last.json`: the worktree is removed below, and the
        // artifact is what a PR commits (`bun run bot:reach`).
        const artifact = join(wt, "data/bot-reach-findings.json");
        if (refreshed && existsSync(artifact))
            copyFileSync(artifact, join(dir, REFRESHED_ARTIFACT_NAME));
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }
    return refreshed;
}

/** The two audits, in full, on the tip the last verdict is about — each in
 *  the foreground under `gate.ts yield`, so a queued `land` goes first. */
function audits(
    root: string,
    dir: string,
    reason: string
): { ran: boolean; ok: boolean } {
    let last: { sha?: string; status?: string } | null = null;
    try {
        last = JSON.parse(readFileSync(join(dir, "last.json"), "utf8"));
    } catch {
        last = null;
    }
    const sha = last?.sha;
    if (!sha || (last?.status !== "green" && last?.status !== "red")) {
        console.log(
            `health-nightly: audits owed (${reason}) but no GREEN or RED verdict to follow (last: ${last?.status ?? "none"}) — next night`
        );
        return { ran: false, ok: true };
    }
    const mode = { kind: "full" as const, reason: `weekly: ${reason}` };
    writeAuditRequest(dir, sha, mode, true);
    writePickRequest(dir, sha, mode.reason, true);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;
    delete env.TOLARIA_VITEST_WORKERS;
    env.TOLARIA_GATE_ROLE = HEALTH_ROLE;
    let ok = true;
    for (const script of [ROBUSTNESS_AUDIT, PICK_AGREEMENT_AUDIT]) {
        console.log(
            `health-nightly: ${script.split("/").pop()} on ${sha.slice(0, 12)} (${reason})`
        );
        const r = spawnSync(
            "bun",
            [GATE, "yield", `bun ${JSON.stringify(script)} --sha=${sha}`],
            { cwd: root, env, stdio: "inherit" }
        );
        if (r.status !== 0) ok = false;
    }
    return { ran: true, ok };
}

async function main(): Promise<number> {
    const root = primaryCheckout(process.cwd());
    const dir = join(root, HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    const record = readRecord(dir);
    let code = 0;

    git(["fetch", "origin", BASE_BRANCH, "-q"], root);
    const tip = git(["rev-parse", ORIGIN_BASE], root);
    const changed = changedSince(root, record.refreshedSha, tip);
    if (record.refreshedSha === tip) {
        console.log(
            `health-nightly: Bot Findings already measured at ${tip.slice(0, 12)}`
        );
    } else if (!batchTouchesBot(changed)) {
        console.log(
            `health-nightly: the base left the Bot alone since ${record.refreshedSha?.slice(0, 12)} — no refresh`
        );
        record.refreshedSha = tip;
        writeRecord(dir, record);
    } else if (await refresh(root, dir, tip)) {
        record.refreshedSha = tip;
        writeRecord(dir, record);
    } else {
        code = 1;
    }

    const due = auditsDue({
        now: new Date(),
        lastAuditAt: record.auditedAt,
        force: process.argv.includes("--audits"),
    });
    if (!due.due) {
        console.log(`health-nightly: no audits — ${due.reason}`);
        return code;
    }
    // Stamped once they ran, pass or fail: an audit that crashes is not
    // re-run every night until it passes — its own record says how it ended.
    // One that found no verdict to follow did not run, and is owed tomorrow.
    const startedAt = Date.now();
    const run = audits(root, dir, due.reason);
    if (!run.ok) code = 1;
    if (run.ran) writeRecord(dir, { ...readRecord(dir), auditedAt: startedAt });
    return code;
}

main().then(
    (code) => process.exit(code),
    (err: unknown) => {
        console.error(err);
        process.exit(1);
    }
);
