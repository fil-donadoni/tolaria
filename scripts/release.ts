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
//   bun run release --gate-only         # everything except the push (release.yml's dry run)
//   bun run release --no-fix            # today's behaviour: refuse on RED, spawn nothing
//   bun run release --max-fix-attempts=N  # move the bound (default 3, min 2)
//
// Runs from the primary checkout (health-main.ts insists on it: a linked
// worktree's `.env.local` is absent and the health worktree is created
// beside the primary) — or from the job worktree of `release.yml` (issue
// #5647), the one linked worktree health accepts. `git push` is a plain refspec `<sha>:refs/heads/<release>`,
// so a release branch that somehow moved off the base's history is refused
// by git itself as a non-fast-forward.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "./lib/branches";
import { netEnv } from "./lib/gh";
import type { HealthStatus } from "./lib/health-verdict";
import {
    machineName,
    verdictStore,
    type Verdict,
    type VerdictStore,
} from "./lib/health-verdict-store";
import {
    MANUAL_COMMAND,
    parseVerdict,
    verdictPath,
    type FixVerdict,
} from "./health-fix";
import { refuseCorpusExclusion } from "./lib/corpus-exclusion";
import { inJobWorktree } from "./lib/health-verdict-job";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    currentBranch,
    primaryBranchRefusal,
    skewRemedy,
} from "./lib/deployment-skew";

const HEALTH_MAIN = resolve(__dirname, "health-main.ts");
const HEALTH_FIX = resolve(__dirname, "health-fix.ts");
const LAST_JSON = join(".claude", "telemetry", "health", "last.json");

/** Rounds before the loop gives up. Three, so a tip red at `test:app` and
 *  then at `test:bot` still completes without a second `release` by hand. */
export const DEFAULT_FIX_ATTEMPTS = 3;

export interface HealthRecord {
    sha: string;
    status: HealthStatus;
    failedStep?: string;
    log?: string;
    /** The machine that wrote the verdict, when the store says (issue #5466). */
    machine?: string;
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
            reason: `health is ${last.status.toUpperCase()} @ ${tip.slice(0, 8)}${last.failedStep ? ` (failed at ${last.failedStep})` : ""}${last.machine ? ` on ${last.machine}` : ""}${last.log ? ` — log: ${last.log}` : ""}`,
            // A RUNNING record is not repairable: another gate holds the sha
            // and must not be raced. Nor is INFRA (issue #4938): the tree was
            // never shown wrong, so there is nothing for a fixer to fix.
            red: last.status === "red",
        };
    }
    return { kind: "release", sha: tip };
}

/**
 * The record `releaseDecision` judges (issue #5466): the verdict STORE is the
 * shared truth, `last.json` only this machine's own run. A RED the store holds
 * for the sha wins over a local `running` or stale record — a RED written by
 * the other machine must refuse a release here. Otherwise the local record
 * about the sha, then whatever settled verdict the store holds for it.
 */
export function reconcileRecord(
    sha: string,
    last: HealthRecord | null,
    stored: Verdict | null
): HealthRecord | null {
    const about = stored?.sha === sha ? stored : null;
    if (about?.status === "red") return recordOf(about);
    if (last?.sha === sha) return last;
    if (about?.status === "green" || about?.status === "infra")
        return recordOf(about);
    return last;
}

function recordOf(v: Verdict): HealthRecord {
    return {
        sha: v.sha,
        status: v.status as HealthStatus,
        failedStep: v.step,
        log: v.log,
        machine: v.machine,
    };
}

/** The stored verdict for `sha`; an unreadable store reads as none (the local
 *  record still decides) and says so, never a throw. */
function readStored(store: () => VerdictStore, sha: string): Verdict | null {
    try {
        return store().read(sha);
    } catch (e) {
        console.error(
            `release: the verdict store could not be read — ${(e as Error).message}`
        );
        return null;
    }
}

/**
 * Write this release's own verdict through the store (issue #5466), so the
 * other machine sees it. Only a settled GREEN / RED the store does not
 * already hold; never fatal — the release decision is already made.
 */
export function publishVerdict(
    store: () => VerdictStore,
    record: HealthRecord | null,
    stored: Verdict | null
): void {
    if (record === null) return;
    if (record.status !== "green" && record.status !== "red") return;
    if (stored?.status === record.status) return;
    try {
        const out = store().write({
            sha: record.sha,
            status: record.status,
            step: record.failedStep ?? "release",
            log: record.log,
            machine: machineName(),
            at: new Date().toISOString(),
        });
        if (!out.written)
            console.error(
                `release: verdict store kept its record — ${out.reason}`
            );
    } catch (e) {
        console.error(
            `release: the verdict store could not be written — ${(e as Error).message}`
        );
    }
}

/**
 * The last word before the push (issue #5647): the release branch moves only
 * to a sha whose settled record is GREEN and about THAT sha. `releaseDecision`
 * already said so once; this re-asks of the record the push is about to act
 * on, so a refactor of the loop cannot promote a tip health never proved.
 * Null: push.
 */
export function pushRefusal(
    sha: string,
    record: HealthRecord | null
): string | null {
    const d = releaseDecision(sha, record);
    return d.kind === "release" ? null : d.reason;
}

export type LoopDecision =
    | { kind: "release"; sha: string }
    /** `reason` is the health refusal that sent this round to the fixer — the
     *  handover names it when the loop later gives up. */
    | { kind: "fix"; sha: string; reason: string }
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
    return { kind: "fix", sha: tip, reason: decision.reason };
}

export type FixBound = { max: number } | { error: string };

/** `--max-fix-attempts=N`, defaulting to three. Pure: the flag is the whole
 *  input, and a garbage value is an error rather than a silent default. */
export function parseFixBound(argv: string[]): FixBound {
    const flag = argv.find((a) => a.startsWith("--max-fix-attempts="));
    if (flag === undefined) return { max: DEFAULT_FIX_ATTEMPTS };
    const raw = flag.slice("--max-fix-attempts=".length);
    const n = Number(raw);
    // A round is one gate plus at most one fix, and a fix is only worth
    // starting when a LATER round can re-gate what it landed. So a bound of
    // one is not "one fix" — it is no fix at all, which is `--no-fix` wearing
    // a name that promises the opposite.
    if (!Number.isInteger(n) || n < 2) {
        return {
            error: `--max-fix-attempts must be an integer >= 2 (a bound of 1 leaves no round to re-gate a fix — use --no-fix), got ${JSON.stringify(raw)}`,
        };
    }
    return { max: n };
}

/**
 * Where health-main keeps its records (issue #5647): the primary checkout.
 * `--git-common-dir` is relative in the primary itself and absolute in a
 * linked worktree — a release job's — whose own tree holds no `last.json`.
 */
export function recordRoot(common: string, cwd: string): string {
    return common.startsWith("/") ? dirname(resolve(common)) : cwd;
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
    spawnSync("bun", [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, "--ui-all"], {
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
function runFixer(cwd: string, root: string, sha: string): FixVerdict {
    const r = spawnSync("bun", [HEALTH_FIX], {
        stdio: "inherit",
        cwd,
        env: netEnv(process.env),
    });
    const verdict = parseVerdict(readVerdictFile(root), sha);
    // The exit status is NOT the verdict — that is the whole point of the
    // file. But a child that refused to spawn at all (its own TTY check, or a
    // tip that moved under it) leaves no verdict, and reporting that as a
    // bare "the fixer wrote no verdict file" hides the reason it printed.
    if (verdict.outcome === "stuck" && r.status !== 0) {
        return {
            ...verdict,
            note: `${verdict.note} (health:fix exited ${r.status ?? "on a signal"} — its refusal is above)`,
        };
    }
    return verdict;
}

/** The handover: every round's attempt, then today's refusal line verbatim. */
function giveUp(attempts: string[], reason: string): never {
    for (const a of attempts) console.error(`release: ${a}`);
    console.error(`release: refusing — ${reason}`);
    process.exit(1);
}

function main(): void {
    // A gating lane never skips the committed-corpus tests (issue #5675).
    refuseCorpusExclusion("release");
    const cwd = process.cwd();
    const dryRun = process.argv.includes("--dry-run");
    // `release.yml`'s dry run: the gate, the verdict, the decision — no push.
    const gateOnly = process.argv.includes("--gate-only");
    const fixEnabled = !process.argv.includes("--no-fix");
    const bound = parseFixBound(process.argv);
    if ("error" in bound) {
        console.error(`release: ${bound.error}`);
        process.exit(2);
    }
    const maxAttempts = bound.max;
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    if (common !== ".git" && !inJobWorktree(cwd, process.env)) {
        console.error(
            "release: run from the primary checkout or a release job's worktree (the health gate creates its worktree beside the primary)"
        );
        process.exit(2);
    }
    // The walk at the end of the gate talks to the deployment `convex dev`
    // pushes from the PRIMARY checkout (issue #6132): off the base branch, it
    // serves other code and the walk could only end INFRA — ~40 minutes of
    // gates later. Refused here, in seconds.
    const primary = primaryCheckout(cwd);
    const offBase = primaryBranchRefusal(currentBranch(primary), BASE_BRANCH);
    if (offBase !== null) {
        console.error(
            `release: refusing — ${offBase}; ${skewRemedy(primary, BASE_BRANCH)}`
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
    let promoted: HealthRecord | null = null;

    const root = recordRoot(common, cwd);
    const store = () => verdictStore(root);
    for (let attempt = 1; promote === null; attempt++) {
        // A RED another machine wrote for this tip is the verdict: re-gating
        // it here would spend a heavy-mutex slot to learn nothing (issue
        // #5466). A RED from THIS machine is re-gated, as before.
        const known = readStored(store, sha);
        const foreignRed =
            known?.status === "red" &&
            known.machine !== undefined &&
            known.machine !== machineName();
        if (!foreignRed) runHealthGate(cwd);
        const stored = foreignRed ? known : readStored(store, sha);
        const record = reconcileRecord(sha, readLast(root), stored);
        publishVerdict(store, record, stored);
        const decision = releaseDecision(sha, record);
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
            promoted = record;
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

        attempts.push(`round ${attempt}: ${step.reason} → handed to the fixer`);
        const after = loopDecision({
            tip: sha,
            decision,
            verdict: runFixer(cwd, root, step.sha),
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

    const refusal = pushRefusal(promote, promoted);
    if (refusal !== null) giveUp(attempts, refusal);
    if (gateOnly) {
        console.log(
            `release: --gate-only — ${promote.slice(0, 8)} is GREEN; ${RELEASE_BRANCH} left where it is`
        );
        return;
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
