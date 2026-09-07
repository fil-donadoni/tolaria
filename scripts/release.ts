#!/usr/bin/env bun
// `bun run release` — promote the base branch's tip to the release branch
// (ADR 0116).
//
// The base branch (`branches.base` in tolaria.config.json) collects landings
// under the LANE gate only. This is the one place the FULL offline gate runs:
// `health-main.ts` gates the `origin/<base>` tip under the heavy mutex, and
// only a GREEN verdict on EXACTLY that sha lets the release branch move —
// by fast-forward, never by force. A RED verdict leaves the marker
// `health-main.ts` wrote and touches nothing; `bun run health:status` shows
// it, and the fix-forward lands on the base branch like any other PR.
//
// Usage:
//   bun run release            # gate origin/<base>, fast-forward <release>
//   bun run release --dry-run  # print the tips and what would happen
//
// Runs from the primary checkout (health-main.ts insists on it: a linked
// worktree's `.env.local` is absent and the health worktree is created
// beside the primary). `git push` is a plain refspec `<sha>:refs/heads/<release>`,
// so a release branch that somehow moved off the base's history is refused
// by git itself as a non-fast-forward.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "./lib/branches";
import { netEnv } from "./lib/gh";

const HEALTH_MAIN = resolve(__dirname, "health-main.ts");
const LAST_JSON = join(".claude", "telemetry", "health", "last.json");

export interface HealthRecord {
    sha: string;
    status: "running" | "green" | "red";
    failedStep?: string;
    log?: string;
}

export type ReleaseDecision =
    | { kind: "release"; sha: string }
    | { kind: "refuse"; reason: string };

/**
 * The one decision this script makes, pure so the test can enumerate it:
 * release iff the last health record is GREEN and is about the sha we are
 * about to promote. A green record on an OLDER tip is not evidence about
 * this one; a `running` record means another health run has the sha and
 * this invocation must not race it.
 */
export function releaseDecision(
    tip: string,
    last: HealthRecord | null
): ReleaseDecision {
    if (last === null) {
        return { kind: "refuse", reason: "no health record was written" };
    }
    if (last.sha !== tip) {
        return {
            kind: "refuse",
            reason: `health record is about ${last.sha.slice(0, 8)}, not the base tip ${tip.slice(0, 8)}`,
        };
    }
    if (last.status !== "green") {
        return {
            kind: "refuse",
            reason: `health is ${last.status.toUpperCase()} @ ${tip.slice(0, 8)}${last.failedStep ? ` (failed at ${last.failedStep})` : ""}${last.log ? ` — log: ${last.log}` : ""}`,
        };
    }
    return { kind: "release", sha: tip };
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

function readLast(root: string): HealthRecord | null {
    const p = join(root, LAST_JSON);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as HealthRecord;
}

function main(): void {
    const cwd = process.cwd();
    const dryRun = process.argv.includes("--dry-run");
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    if (common !== ".git") {
        console.error(
            "release: run from the primary checkout (the health gate creates its worktree beside it)"
        );
        process.exit(2);
    }

    git(["fetch", "origin", BASE_BRANCH, RELEASE_BRANCH, "-q"], cwd);
    const tip = git(["rev-parse", ORIGIN_BASE], cwd);
    const releaseTip = git(["rev-parse", `origin/${RELEASE_BRANCH}`], cwd);
    const ahead = git(
        ["rev-list", "--count", `origin/${RELEASE_BRANCH}..${ORIGIN_BASE}`],
        cwd
    );
    console.log(
        `release: ${ORIGIN_BASE} @ ${tip.slice(0, 8)} is ${ahead} commit(s) ahead of origin/${RELEASE_BRANCH} @ ${releaseTip.slice(0, 8)}`
    );
    if (tip === releaseTip) {
        console.log("release: nothing to release");
        return;
    }
    if (dryRun) {
        console.log(
            `release: --dry-run — would gate ${tip.slice(0, 8)} with the full health gate and fast-forward ${RELEASE_BRANCH} on GREEN`
        );
        return;
    }

    // The full gate, under the heavy mutex. `health-main.ts` dedups by sha
    // (an already-green tip is not re-gated), writes the durable verdict and
    // exits 1 on RED — we read the record rather than the exit status so a
    // verdict about a DIFFERENT sha (a race with another run) is refused too.
    spawnSync("bun", [HEALTH_MAIN, `--branch=${BASE_BRANCH}`], {
        stdio: "inherit",
        cwd,
        env: netEnv(process.env),
    });

    const decision = releaseDecision(tip, readLast(cwd));
    if (decision.kind === "refuse") {
        console.error(`release: refusing — ${decision.reason}`);
        process.exit(1);
    }

    // Plain refspec: git refuses a non-fast-forward on its own, and nothing
    // here ever passes `--force` (deny-guard §2 is about the same invariant).
    git(
        ["push", "origin", `${decision.sha}:refs/heads/${RELEASE_BRANCH}`],
        cwd
    );
    console.log(
        `release: ${RELEASE_BRANCH} → ${decision.sha.slice(0, 8)} (fast-forward)`
    );

    // Keep the primary checkout's local release branch current when it is
    // the one checked out — same guard as land's fast-forward step, and
    // non-gating for the same reason.
    const head = spawnSync(
        "git",
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        {
            encoding: "utf8",
            cwd,
        }
    ).stdout.trim();
    if (head === RELEASE_BRANCH) {
        const r = spawnSync(
            "git",
            ["merge", "--ff-only", "-q", `origin/${RELEASE_BRANCH}`],
            { encoding: "utf8", cwd }
        );
        if (r.status !== 0)
            console.error(
                `release: could not fast-forward local ${RELEASE_BRANCH} — pull it by hand`
            );
    }
}

if (import.meta.main) {
    main();
}
