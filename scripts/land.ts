#!/usr/bin/env bun
/**
 * `bun run land <PR#>` — land a merge-train PR inside ONE `gate.ts heavy`
 * invocation: fetch → rebase origin/main → check:all → test →
 * push --force-with-lease → gh pr merge --squash → write green-sha → tear
 * down the worktree.
 *
 * WHY ONE LOCK (issue #2517). The merge-train (process-gh-issues §4 step 4,
 * Lane B) used to rebase, gate, then merge as three separate steps. Nothing
 * held `main` still between the gate finishing and the merge landing, so with
 * several sessions draining the queue concurrently `main` routinely moved in
 * that gap — measured 2026-08-17: three heavy gates (~20min queueing each)
 * paid for ONE two-file branch nobody else touched, because `main` moved
 * three times between "gate green" and "merge". The machine-wide mutex in
 * `scripts/gate.ts` already serialises GATING; it never covered MERGING, and
 * that gap was the whole bug.
 *
 * So `land` treats fetch/rebase/gate/push/merge as one atomic unit and holds
 * the heavy lock across all of it: a second session's `bun run test` queues
 * behind the WHOLE sequence, not just the suite.
 *
 * RE-ENTRANCY. `check:all` / `test`, run as ordinary `bun run` steps inside
 * the locked shell command, each invoke `gate.ts heavy` themselves. That is
 * safe by construction, not by anything new here: `gate.ts` stamps
 * `TOLARIA_GATE_HELD=1` on the child it spawns (gate.ts:271-272), every
 * process downstream of the locked command inherits it via ordinary env
 * inheritance, and `main()`'s `nested` check (gate.ts:241) makes every inner
 * heavy call skip `acquire()` and pass straight through — no new locking
 * primitive, no deadlock. Do not re-litigate this; it is the settled design
 * from issue #2517.
 *
 * `land` also sets `TOLARIA_ALLOW_FULL_SUITE=1` for its own `gate.ts heavy`
 * call, because the issue-worktree guard (gate.ts:97-123) would otherwise
 * refuse the heavy tier on a `fix/issue-N` / `feat/issue-N` branch — `land`
 * IS the merge-train, the case that guard exempts.
 *
 * `.claude/hooks/deny-guard.sh` §1 still blocks a hand-typed `gh pr merge`
 * from an issue worktree: it inspects Bash TOOL calls, not the child
 * processes a script spawns, so the merge embedded in the locked command
 * below is invisible to it — by design, not a hole. Do not weaken the hook
 * to "fix" this; a hand-typed merge from an issue worktree is exactly what
 * it exists to stop.
 *
 * Usage:
 *   bun run land <PR#>              fetch → rebase → gate → push → merge
 *   bun run land <PR#> --no-merge   …but stop after the push (leave PR open)
 *   bun run land <PR#> --keep       …merge, but skip worktree teardown
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { gh } from "./lib/gh";

// Computed the same way scripts/__tests__/gate.test.ts computes it (from a
// FILE's own directory, not from `import.meta.dir`, which is bun-only and
// would throw when this module is imported under vitest for its pure
// functions).
const GATE = resolve(__dirname, "gate.ts");
const GREEN_SHA_REL = join(".claude", "telemetry", "green-sha");

// ─────────────────────────────────────────────────────────────────────────
// git plumbing — thin and untested, per repo convention (docs-lane.ts,
// worktree-gc.ts): every DECISION below is a pure function, tested directly
// against hand-built facts, never through a subprocess.
// ─────────────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`
        );
    }
    return r.stdout.trim();
}

/** The checkout that owns `.git/` — where `green-sha` lives and worktree
 *  teardown runs from, never the linked worktree `land` is invoked from
 *  (same pattern as docs-lane.ts `primaryCheckout`). */
function primaryCheckout(cwd: string): string {
    const common = git(["rev-parse", "--git-common-dir"], cwd);
    return common.startsWith("/") ? dirname(resolve(common)) : resolve(cwd);
}

function fail(message: string): never {
    console.error(`land: ${message}`);
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// The refusal matrix (issue #2517 AC) — pure, so every case is testable
// without a git fixture or a network call.
// ─────────────────────────────────────────────────────────────────────────

export interface LandFacts {
    /** Current branch in the worktree `land` is run from. */
    branch: string;
    /** `git status --porcelain` non-empty. */
    dirty: boolean;
    /** The PR's `state` from `gh pr view`, or null if the PR was not found. */
    prState: string | null;
    /** The PR's `headRefName` from `gh pr view`, or null if not found. */
    prHeadRefName: string | null;
}

/**
 * Named refusal reason, or null when `land` may proceed. Checked cheapest /
 * most-fundamental first, so a session that is on `main` (or dirty) never
 * pays for a `gh pr view` round trip it could never have used anyway.
 */
export function refusalReason(facts: LandFacts): string | null {
    if (facts.branch === "main") {
        return "on `main` — land runs from the PR's own branch, never from main";
    }
    if (facts.dirty) {
        return "working tree is dirty — commit or stash before landing";
    }
    if (facts.prState === null) {
        return "PR not found";
    }
    if (facts.prState !== "OPEN") {
        return `PR is not open (state: ${facts.prState})`;
    }
    if (facts.prHeadRefName !== facts.branch) {
        return `PR head branch (${facts.prHeadRefName}) does not match the current branch (${facts.branch})`;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// The rebase step — isolated so it can be proven against a REAL conflict
// without spinning up the gate lock or a remote.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Rebase onto `origin/main`; on conflict, print the conflicting paths,
 * `--abort` (leaving the tree usable — never leave a `sh -c` pipeline
 * mid-rebase), and fail. Parenthesised as one unit so a `git fetch` failure
 * (not a conflict) short-circuits the whole `&&` chain instead of also
 * triggering the abort branch.
 */
export function rebaseStep(): string {
    return (
        "git fetch origin main && " +
        "(git rebase origin/main || " +
        "{ git --no-pager diff --name-only --diff-filter=U; git rebase --abort; exit 1; })"
    );
}

// ─────────────────────────────────────────────────────────────────────────
// The locked command — everything that runs inside the ONE `gate.ts heavy`
// invocation. Built as a literal shell string (never a re-invocation of
// `land.ts` itself) precisely so a test can assert the merge — and the push,
// and the gate steps — are textually inside it: the lock cannot be escaped
// by a step that never appears in the string the lock wraps.
// ─────────────────────────────────────────────────────────────────────────

export interface LockedCommandOptions {
    branch: string;
    pr: number;
    /** The main checkout — where green-sha lives and teardown runs from. */
    primaryCheckout: string;
    /** The worktree `land` runs from — removed on teardown. */
    worktree: string;
    /** false for `--no-merge`: gate and push, never merge. */
    merge: boolean;
    /** false for `--keep`: skip worktree teardown after a successful merge. */
    teardown: boolean;
}

function shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function buildLockedCommand(opts: LockedCommandOptions): string {
    const steps: string[] = [
        rebaseStep(),
        "bun run check:all",
        "bun run test",
        `git push --force-with-lease origin ${shQuote(opts.branch)}`,
    ];
    if (opts.merge) {
        steps.push(`gh pr merge ${opts.pr} --squash --delete-branch`);
        // `gh pr merge` lands via the API — it does not update this worktree's
        // local `origin/main`, so re-fetch before reading the new tip.
        steps.push("git fetch origin main -q");
        const greenSha = join(opts.primaryCheckout, GREEN_SHA_REL);
        steps.push(`mkdir -p ${shQuote(dirname(greenSha))}`);
        steps.push(`git rev-parse origin/main > ${shQuote(greenSha)}`);
        if (opts.teardown) {
            steps.push(
                `git -C ${shQuote(opts.primaryCheckout)} worktree remove --force ${shQuote(opts.worktree)}`
            );
        }
    }
    return steps.join(" && ");
}

// ─────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
    pr: number;
    merge: boolean;
    teardown: boolean;
} {
    const positional = argv.filter((a) => !a.startsWith("--"));
    const pr = Number((positional[0] ?? "").replace(/^#/, ""));
    if (!Number.isInteger(pr) || pr <= 0) {
        fail("usage: bun run land <PR#> [--no-merge] [--keep]");
    }
    return {
        pr,
        merge: !argv.includes("--no-merge"),
        teardown: !argv.includes("--keep"),
    };
}

function main(): void {
    const cwd = process.cwd();
    const [, , ...argv] = process.argv;
    const { pr, merge, teardown } = parseArgs(argv);

    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const dirty = git(["status", "--porcelain"], cwd) !== "";

    let prState: string | null = null;
    let prHeadRefName: string | null = null;
    try {
        const raw = gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state,headRefName",
        ]);
        const info = JSON.parse(raw) as { state: string; headRefName: string };
        prState = info.state;
        prHeadRefName = info.headRefName;
    } catch {
        // leave both null — refusalReason reports "PR not found"
    }

    const reason = refusalReason({ branch, dirty, prState, prHeadRefName });
    if (reason) fail(`refusing — ${reason}`);

    const primary = primaryCheckout(cwd);
    const command = buildLockedCommand({
        branch,
        pr,
        primaryCheckout: primary,
        worktree: cwd,
        merge,
        teardown,
    });

    console.log(
        `land: gating PR #${pr} on ${branch} — one heavy lock, ${
            merge ? "with" : "without"
        } merge`
    );
    const result = spawnSync("bun", [GATE, "heavy", command], {
        stdio: "inherit",
        cwd,
        env: { ...process.env, TOLARIA_ALLOW_FULL_SUITE: "1" },
    });
    process.exit(result.status ?? 1);
}

if (import.meta.main) {
    main();
}
