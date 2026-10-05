/**
 * The blade robustness audit, run AFTER the health verdict (issue #5079).
 *
 *   bun scripts/health-robustness-audit.ts
 *
 * Spawned detached by `health-cadence` once a run's verdict is GREEN or RED,
 * wrapped in `gate.ts yield` (the lowest admission class, like the batch
 * gate): a queued `land` is never made to wait for it. It audits the tip the
 * verdict is about, in its own worktree, files drift as issues and leaves
 * `robustness-audit.json` for `health:status`. It never writes `last.json` or
 * the RED marker, and `release` does not wait for it. Why this is safe to take
 * out of the gates: `lib/health-robustness-audit.ts`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
    claimAuditRequest,
    runAudit,
    type VerdictRecord,
} from "./lib/health-robustness-audit";
import { ROBUSTNESS_STEP } from "./lib/health-robustness-drift";
import {
    healthGateEnv,
    healthStepArgs,
    runHealthStep,
    WALK_BOOTSTRAP,
} from "./lib/health-step";
import { infraCause, readLastSleepAt } from "./lib/health-verdict";
import {
    readMachineSample,
    readMachineConfig,
    runSaturated,
} from "./lib/machine-admission";

const HEALTH_DIR = ".claude/telemetry/health";

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

function primaryCheckout(cwd: string): string {
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    return common.startsWith("/") ? dirname(resolve(common)) : cwd;
}

function readLast(dir: string): VerdictRecord | null {
    try {
        return JSON.parse(
            readFileSync(join(dir, "last.json"), "utf8")
        ) as VerdictRecord;
    } catch {
        return null;
    }
}

async function main(): Promise<void> {
    const root = primaryCheckout(process.cwd());
    const dir = join(root, HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    const request = claimAuditRequest(dir, readLast(dir));
    if (request === null) {
        console.log(
            "health-robustness-audit: nothing owed (no request for the recorded verdict)"
        );
        return;
    }
    const log = join(dir, `${request.sha.slice(0, 12)}.robustness.log`);
    const wt = join(root, "..", `tolaria-robustness-${process.pid}`);
    // The yield acquisition wrapping this process is the hold: the audit's own
    // `gate.ts heavy` passes through it (`keepHold`).
    const env = healthGateEnv(process.env, { keepHold: true });
    const thresholds = readMachineConfig();
    git(["worktree", "add", "--detach", wt, request.sha], root);
    try {
        const run = async (): Promise<{
            ok: boolean;
            output: string;
            excused: boolean;
        }> => {
            const boot = await runHealthStep(
                {
                    ordinal: 1,
                    total: 2,
                    name: WALK_BOOTSTRAP,
                    cmd: "bun",
                    args: healthStepArgs(WALK_BOOTSTRAP),
                },
                { cwd: wt, env, logPath: log }
            );
            if (!boot.ok) return { ...boot, excused: false };
            const startedAt = Date.now();
            const before = readMachineSample();
            const r = await runHealthStep(
                {
                    ordinal: 2,
                    total: 2,
                    name: ROBUSTNESS_STEP,
                    cmd: "bun",
                    args: healthStepArgs(ROBUSTNESS_STEP),
                    env: request.env,
                },
                { cwd: wt, env, logPath: log }
            );
            const cause = infraCause({
                ok: r.ok,
                startedAt,
                lastSleepAt: readLastSleepAt(),
                step: ROBUSTNESS_STEP,
                exitCode: r.status,
                output: r.output,
                machineSaturated: runSaturated(
                    [before, readMachineSample()],
                    thresholds
                ),
            });
            return { ok: r.ok, output: r.output, excused: cause !== null };
        };
        const record = await runAudit({ dir, request, log, run });
        console.log(
            `health-robustness-audit: ${record.status} @ ${request.sha.slice(0, 8)}${record.filed.map((l) => `\n  ${l}`).join("")}`
        );
    } finally {
        spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
