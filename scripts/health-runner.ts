#!/usr/bin/env bun
/**
 * The health runner (issue #5467, ADR 0154 §9): batch health on the machine
 * `healthRunner.platform` names — the Huawei in topology B' — driven by a
 * systemd timer every few minutes, never by `land`.
 *
 * One tick: fetch `origin/<base>`, read the verdict store's lineage, count
 * the base commits since the last gated tip with git, and ask `runnerPlan` —
 * the SAME cadence rule `land`'s `health-cadence detach` applies, rebuilt
 * from shared state, so no ledger file crosses machines and no ssh is needed.
 * On a fire it runs `health-main` exactly as `detach` does
 * (`runHealthGate`: offline gates under one `gate.ts yield`, then the walk if
 * owed), in `health-main`'s own throwaway worktree, and `health-main` writes
 * the verdict through the store.
 *
 * It never claims, never lands, never seeds a scenario, and never hands a RED
 * to `health:fix` — the sessions that repair it run on the MacBook. On a
 * SECOND RED it stops gating and notifies the owner once.
 *
 *   bun run health:runner             one tick (the systemd service's ExecStart)
 *   bun run health:runner --dry-run   print the decision, run nothing, write nothing
 *
 * Install, environment and recovery: `docs/guides/huawei-runner.md`
 * § The health runner.
 */
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import { healthRunnerMode } from "./lib/health-cadence";
import {
    parseCommitLines,
    parseRunnerState,
    runnerTick,
    RUNNER_FILE,
    type RunnerDeps,
} from "./lib/health-runner";
import { verdictStore } from "./lib/health-verdict-store";
import { notifyOwner } from "./lib/notify-owner";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    HEALTH_DIR,
    readHealthRunnerConfig,
    readLast,
    runHealthGate,
} from "./health-cadence";

// ─────────────────────────────────────────────────────────────────────────────
// The real dependencies
// ─────────────────────────────────────────────────────────────────────────────

function git(root: string, args: string[]): { ok: boolean; out: string } {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function realDeps(root: string, branch: string): RunnerDeps {
    const statePath = join(root, HEALTH_DIR, RUNNER_FILE);
    return {
        fetchTip() {
            const f = git(root, ["fetch", "origin", branch, "-q"]);
            if (!f.ok) throw new Error(`git fetch origin ${branch} failed`);
            return git(root, ["rev-parse", `origin/${branch}`]).out;
        },
        commitsSince(base, tip) {
            if (!git(root, ["merge-base", "--is-ancestor", base, tip]).ok)
                return null;
            const r = git(root, [
                "log",
                "--first-parent",
                "--reverse",
                "--format=%H %ct",
                `${base}..${tip}`,
            ]);
            return r.ok ? parseCommitLines(r.out) : null;
        },
        store: () => verdictStore(root, { branch }),
        readLast: () => readLast(root),
        readState: () =>
            parseRunnerState(
                existsSync(statePath) ? readFileSync(statePath, "utf8") : null
            ),
        writeState(state) {
            mkdirSync(join(root, HEALTH_DIR), { recursive: true });
            const tmp = `${statePath}.${process.pid}.tmp`;
            writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
            renameSync(tmp, statePath);
        },
        runHealth: (tip, firedAt) =>
            runHealthGate(root, branch, tip, firedAt, { retryInfra: true }),
        notify: (message) => notifyOwner(message, "Tolaria health"),
        now: () => Date.now(),
        log: (line) => console.log(line),
    };
}

function main(): void {
    const dryRun = process.argv.includes("--dry-run");
    const branchArg = process.argv.find((a) => a.startsWith("--branch="));
    const branch = branchArg
        ? branchArg.slice("--branch=".length)
        : BASE_BRANCH;
    const config = readHealthRunnerConfig();
    const mode = healthRunnerMode(config, process.platform);
    if (mode !== "here") {
        const why =
            config.platform === null
                ? "no healthRunner.platform in tolaria.config.json: `land`'s cadence gates locally"
                : `this machine is \`${process.platform}\`; the runner gates on \`${config.platform}\` only (tolaria.config.json healthRunner.platform)`;
        if (!dryRun) {
            console.log(`health-runner: ${why} — nothing to do`);
            process.exit(0);
        }
        console.log(`health-runner: [dry-run] ${why} — deciding anyway`);
    }
    const root = primaryCheckout(process.cwd());
    process.exit(runnerTick(realDeps(root, branch), { dryRun }).code);
}

if (import.meta.main) {
    main();
}
