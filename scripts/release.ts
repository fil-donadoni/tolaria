#!/usr/bin/env bun
// `bun run release` — promote the base branch's tip to the release branch
// (ADR 0116).
//
// The base branch (`branches.base` in tolaria.config.json) collects landings
// under the LANE gate only. This is the one place the FULL offline gate runs:
// `health-main.ts` gates the `origin/<base>` tip under the heavy mutex, and
// only a GREEN verdict on EXACTLY that sha lets the release branch move —
// by fast-forward, never by force.
//
// A RED verdict used to end the run: the marker `health-main.ts` wrote stayed
// standing and the maintainer was handed a log path. Since PRD issue #3197 it
// starts a REPAIR instead. Per round: gate, take `releaseDecision`, and when
// it refuses *specifically* because the verdict is RED — with a terminal, and
// rounds remaining — hand the tip to `bun run health:fix`, which spawns an
// interactive fixer session on the `/health-fix` skill and leaves a verdict
// file. A `landed` verdict means the base branch moved, so the tip is re-read
// from the remote before the next round; the sha is new, so `health-main.ts`'s
// own sha-dedup does not short-circuit the next gate. Anything else ends the
// loop and reports what every round attempted.
//
// Three rounds rather than one because the health gate stops at its FIRST
// failing step and `bun run test` runs its three suites in series: a tip can
// be legitimately red at `test:app` and then at `test:bot` with no error by
// the fixer. Bounded, because a fixer oscillating between two repairs would
// otherwise burn gates all night.
//
// Usage:
//   bun run release                     # gate origin/<base>, fast-forward <release>
//   bun run release --dry-run           # print the tips and what would happen
//   bun run release --no-fix            # today's behaviour: refuse on RED, spawn nothing
//   bun run release --max-fix-attempts=N  # move the bound (default 3)
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
import {
    MANUAL_COMMAND,
    parseVerdict,
    verdictPath,
    type FixVerdict,
} from "./health-fix";

const HEALTH_MAIN = resolve(__dirname, "health-main.ts");
const HEALTH_FIX = resolve(__dirname, "health-fix.ts");
const LAST_JSON = join(".claude", "telemetry", "health", "last.json");

/** Rounds before the loop gives up. Three, so a tip red at `test:app` and
 *  then at `test:bot` still completes without a second `release` by hand. */
export const DEFAULT_FIX_ATTEMPTS = 3;

export interface HealthRecord {
    sha: string;
    status: "running" | "green" | "red";
    failedStep?: string;
    log?: string;
}

export type ReleaseDecision =
    | { kind: "release"; sha: string }
    /** `red` is the structured discriminator the fix loop branches on: only a
     *  verdict that is RED *about this tip* is repairable, and a caller must
     *  never have to sniff `reason` to tell that from a stale or missing
     *  record. Same shape as `spawnDecision`'s `nothingToFix`. */
    | { kind: "refuse"; reason: string; red: boolean };

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
        return {
            kind: "refuse",
            reason: "no health record was written",
            red: false,
        };
    }
    if (last.sha !== tip) {
        return {
            kind: "refuse",
            reason: `health record is about ${last.sha.slice(0, 8)}, not the base tip ${tip.slice(0, 8)}`,
            red: false,
        };
    }
    if (last.status !== "green") {
        return {
            kind: "refuse",
            reason: `health is ${last.status.toUpperCase()} @ ${tip.slice(0, 8)}${last.failedStep ? ` (failed at ${last.failedStep})` : ""}${last.log ? ` — log: ${last.log}` : ""}`,
            // A RUNNING record is not repairable: another gate holds the sha
            // and must not be raced.
            red: last.status === "red",
        };
    }
    return { kind: "release", sha: tip };
}

export type LoopDecision =
    | { kind: "release"; sha: string }
    | { kind: "fix"; sha: string }
    /** The fixer landed: re-read the tip and gate again. */
    | { kind: "retry"; note: string }
    | { kind: "stop"; reason: string };

export interface LoopInputs {
    /** The tip just gated — the sha a fix would be about. A refusal does not
     *  carry one, and the loop must not have to reach into the record for it. */
    tip: string;
    /** The health decision for the tip just gated. */
    decision: ReleaseDecision;
    /** The verdict of the fix attempted in THIS round, or null before one
     *  has been attempted. The two moments are the same decision: what does
     *  the loop do next, given everything known so far. */
    verdict: FixVerdict | null;
    /** 1-based round. A round is one gate, plus at most one fix. */
    attempt: number;
    maxAttempts: number;
    /** Is stdin a terminal — i.e. is there a human for the fixer to grill? */
    interactive: boolean;
    /** False under `--no-fix`. */
    fixEnabled: boolean;
}

/**
 * The whole loop branch — release, fix, retry or stop — pure so every path is
 * enumerable in a test rather than reachable only by running a real gate and
 * spawning a real agent.
 *
 * With `verdict === null` it answers the gate: promote, repair, or refuse.
 * With a verdict it answers the fixer: only an unambiguous `landed` buys
 * another round, because everything else already read as `stuck` in
 * `parseVerdict` — fail-closed, since the failure mode of the alternative is
 * promoting a tip nobody fixed.
 */
export function loopDecision(input: LoopInputs): LoopDecision {
    const {
        tip,
        decision,
        verdict,
        attempt,
        maxAttempts,
        interactive,
        fixEnabled,
    } = input;

    if (verdict !== null) {
        if (verdict.outcome !== "landed") {
            return {
                kind: "stop",
                reason: `the fixer is STUCK @ ${verdict.sha.slice(0, 8)}${verdict.pr ? ` (PR #${verdict.pr})` : ""} — ${verdict.note ?? "no note"}`,
            };
        }
        return {
            kind: "retry",
            note: `round ${attempt}: the fixer LANDED${verdict.pr ? ` PR #${verdict.pr}` : ""}${verdict.note ? ` — ${verdict.note}` : ""}`,
        };
    }

    if (decision.kind === "release") {
        return { kind: "release", sha: decision.sha };
    }
    // Everything below is a refusal. `--no-fix` and a non-RED refusal both
    // reproduce today's behaviour EXACTLY — the reason is passed through
    // untouched, so the printed line is byte-identical.
    if (!decision.red || !fixEnabled) {
        return { kind: "stop", reason: decision.reason };
    }
    if (!interactive) {
        return {
            kind: "stop",
            reason: `${decision.reason} — no terminal to spawn a fixer into; run '${MANUAL_COMMAND}' from a terminal`,
        };
    }
    if (attempt >= maxAttempts) {
        return {
            kind: "stop",
            reason: `${decision.reason} — out of fix rounds (${maxAttempts})`,
        };
    }
    return { kind: "fix", sha: tip };
}

export type FixBound = { max: number } | { error: string };

/** `--max-fix-attempts=N`, defaulting to three. Pure: the flag is the whole
 *  input, and a garbage value is an error rather than a silent default. */
export function parseFixBound(argv: string[]): FixBound {
    const flag = argv.find((a) => a.startsWith("--max-fix-attempts="));
    if (flag === undefined) return { max: DEFAULT_FIX_ATTEMPTS };
    const raw = flag.slice("--max-fix-attempts=".length);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        return {
            error: `--max-fix-attempts must be a positive integer, got ${JSON.stringify(raw)}`,
        };
    }
    return { max: n };
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

function readVerdictFile(root: string): string | null {
    const p = verdictPath(root);
    if (!existsSync(p)) return null;
    try {
        return readFileSync(p, "utf8");
    } catch {
        return null;
    }
}

/**
 * The full gate, under the heavy mutex. `health-main.ts` dedups by sha (an
 * already-green tip is not re-gated), writes the durable verdict and exits 1
 * on RED — we read the RECORD rather than the exit status, so a verdict about
 * a DIFFERENT sha (a race with another run) is refused too.
 */
function runHealthGate(cwd: string): void {
    spawnSync("bun", [HEALTH_MAIN, `--branch=${BASE_BRANCH}`], {
        stdio: "inherit",
        cwd,
        env: netEnv(process.env),
    });
}

/**
 * Hand the tip to the fixer and read back what it concluded. The child owns
 * the refusal conditions and the interactive spawn (issue #3199); the return
 * channel is the verdict FILE, because an interactive `claude` exits 0
 * whatever happened inside it.
 */
function runFixer(cwd: string, sha: string): FixVerdict {
    spawnSync("bun", [HEALTH_FIX], {
        stdio: "inherit",
        cwd,
        env: netEnv(process.env),
    });
    return parseVerdict(readVerdictFile(cwd), sha);
}

/** The handover: every round's attempt, then today's refusal line verbatim. */
function giveUp(attempts: string[], reason: string): never {
    for (const a of attempts) console.error(`release: ${a}`);
    console.error(`release: refusing — ${reason}`);
    process.exit(1);
}

function main(): void {
    const cwd = process.cwd();
    const dryRun = process.argv.includes("--dry-run");
    const fixEnabled = !process.argv.includes("--no-fix");
    const bound = parseFixBound(process.argv);
    if ("error" in bound) {
        console.error(`release: ${bound.error}`);
        process.exit(2);
    }
    const maxAttempts = bound.max;
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

    // The bounded fix loop (PRD issue #3197). One round is one gate plus at
    // most one fix; `attempts` is what the handover names when we give up.
    const attempts: string[] = [];
    let sha = tip;
    let promote: string | null = null;

    for (let attempt = 1; promote === null; attempt++) {
        runHealthGate(cwd);
        const decision = releaseDecision(sha, readLast(cwd));
        const step = loopDecision({
            tip: sha,
            decision,
            verdict: null,
            attempt,
            maxAttempts,
            interactive: process.stdin.isTTY === true,
            fixEnabled,
        });

        if (step.kind === "release") {
            promote = step.sha;
            break;
        }
        if (step.kind !== "fix") {
            // `retry` answers a VERDICT, and this call passed none — the
            // remaining branch is a refusal.
            giveUp(
                attempts,
                step.kind === "stop"
                    ? step.reason
                    : "unreachable: retry with no verdict"
            );
        }

        attempts.push(
            `round ${attempt}: ${decision.kind === "refuse" ? decision.reason : ""} → handed to the fixer`
        );
        const after = loopDecision({
            tip: sha,
            decision,
            verdict: runFixer(cwd, step.sha),
            attempt,
            maxAttempts,
            interactive: true,
            fixEnabled,
        });
        if (after.kind !== "retry") {
            giveUp(
                attempts,
                after.kind === "stop" ? after.reason : "unreachable"
            );
        }
        console.log(`release: ${after.note}`);

        // The fixer landed, so the base branch moved: re-read the tip, or the
        // next round would gate the tree that was already red.
        git(["fetch", "origin", BASE_BRANCH, "-q"], cwd);
        sha = git(["rev-parse", ORIGIN_BASE], cwd);
    }

    // Plain refspec: git refuses a non-fast-forward on its own, and nothing
    // here ever passes `--force` (deny-guard §2 is about the same invariant).
    git(["push", "origin", `${promote}:refs/heads/${RELEASE_BRANCH}`], cwd);
    console.log(
        `release: ${RELEASE_BRANCH} → ${promote.slice(0, 8)} (fast-forward)`
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
