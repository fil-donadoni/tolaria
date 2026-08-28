#!/usr/bin/env bun
/**
 * `bun run land <PR#>` — land a PR inside ONE `gate.ts heavy`
 * invocation: fetch → rebase origin/main → check:lane →
 * push --force-with-lease → `pr-merge.ts` (settle-aware squash merge) →
 * write green-sha → fast-forward the primary checkout's local `main` →
 * tear down the worktree.
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
 * CREDENTIALS. `lockedEnv()` strips `GITHUB_TOKEN` from the env `land.ts`
 * hands to `spawnSync("bun", [GATE, …])` the same way `scripts/lib/gh.ts`
 * already does for every `gh()` call this file makes directly — but that is
 * NOT sufficient by itself: the spawned child is `bun scripts/gate.ts`, and
 * **bun auto-loads `.env.local` from ITS OWN cwd** (the worktree, which
 * carries the server-side bug-report PAT), silently re-injecting
 * `GITHUB_TOKEN` into gate.ts's OWN `process.env` regardless of what env
 * `land.ts` passed in. `gate.ts` then spreads `{...process.env}` onto the
 * `sh -c` child that runs the embedded `gh pr merge` (review round 3, B1).
 * `sh` does not read `.env.local`, so `buildLockedCommand` also `unset`s
 * `GITHUB_TOKEN` as the FIRST thing the locked shell string does — the one
 * point in the pipeline `.env.local` cannot re-populate. Without EITHER
 * layer the embedded merge 403s AFTER `check:all` + `test` have already run
 * inside the lock. The merge is now `bun scripts/pr-merge.ts` (#2536), which
 * is a THIRD bun process reading `.env.local` from the worktree cwd — it goes
 * through `lib/gh`'s `gh()`, whose `netEnv()` strips the PAT for the `gh`
 * child, so the same rule holds one level deeper.
 *
 * MERGE VERIFICATION + REF CLEANUP. `gh pr merge` runs WITHOUT
 * `--delete-branch`: `gh` switches the local repo to the default branch
 * before deleting, and `main` is checked out in the primary worktree, so
 * that step dies with `fatal: 'main' is already used by worktree at …`
 * AFTER the API merge has already landed — found and documented first in
 * `scripts/docs-lane.ts:315-321`. `buildLockedCommand` instead (a) records
 * the pre-merge `origin/main` tip, merges, re-fetches, and refuses to write
 * `green-sha` unless the tip advanced by EXACTLY one commit (the squash) —
 * the machine-wide gate lock only covers this machine, a push from
 * elsewhere can still land in the gap — and (b) deletes the remote and
 * local branch refs itself, AFTER the green-sha write, each wrapped so a
 * ref-cleanup failure can never suppress that write or make `land` report
 * failure on a PR that in fact merged: ref cleanup is cosmetic, the merge
 * is not.
 *
 * Usage:
 *   bun run land <PR#>              fetch → rebase → gate → push → merge
 *   bun run land <PR#> --no-merge   …but stop after the push (leave PR open)
 *   bun run land <PR#> --keep       …merge, but skip worktree teardown
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gh, netEnv } from "./lib/gh";
import { primaryCheckout } from "./lib/primary-checkout";
import { changedPaths, classifyLane, type Lane } from "./check-lane";
import { verifyReceiptText } from "./ui-gate/verify-receipt.ts";

/**
 * The one DECISION `land` makes about a `check:ui` receipt (issue #2760),
 * pulled out as a pure function per this file's own convention (git/gh
 * plumbing stays thin and untested; every decision is testable directly) —
 * `main()` only supplies the two impure inputs (the classified lane, the PR
 * body text).
 */
export function computeSkinReceiptInvalid(lane: Lane, prBody: string): boolean {
    return lane === "skin" && !verifyReceiptText(prBody).ok;
}

/**
 * A `src/**` diff made ONLY of test files cannot reach the DOM, so it owes
 * no `check:ui` receipt (ADR 0110 §4; `.claude/rules/chrome-debug.md`
 * already said nothing is owed — this makes the classifier agree). The
 * incident that forced it: a one-line test-constant green-main repair was
 * refused over a receipt for a diff with no rendered surface (2026-08-27).
 * Pure, so it is testable without git.
 */
export function isTestOnlySrcDiff(paths: string[]): boolean {
    const src = paths.filter((p) => p.startsWith("src/"));
    if (src.length === 0) return false;
    return src.every(
        (p) => /(^|\/)__tests__\//.test(p) || /\.test\.[tj]sx?$/.test(p)
    );
}

/**
 * `classifyLane(changedPaths("origin/main", cwd, true))` plus
 * `computeSkinReceiptInvalid`, tolerating a failure in the diff computation
 * (issue #2760 review, finding 6). `changedPaths` shells out to
 * `git diff … origin/main...HEAD` (`check-lane.ts`'s `git()` throws on
 * non-zero status), and this call ran BEFORE any of `refusalReason`'s
 * refusal checks — so a checkout whose `origin/main` was never fetched
 * crashed `land` with an unhandled stack trace instead of the existing
 * "refusing — …" message, on EVERY lane, including an engine/full landing
 * this feature owes nothing to.
 *
 * On failure: warn and treat the diff as not-skin. `land` is not blind to a
 * real skin diff this way — a caller actually landing one still needs a
 * fetched `origin/main` for the rebase step a few lines later in `main()`,
 * so a genuine problem resurfaces there (loudly, inside the gate) instead of
 * as a bare stack trace before any refusal check ran.
 */
export function safeSkinReceiptInvalid(cwd: string, prBody: string): boolean {
    try {
        const paths = changedPaths("origin/main", cwd, true);
        const lane = classifyLane(paths).lane;
        if (lane === "skin" && isTestOnlySrcDiff(paths)) return false;
        return computeSkinReceiptInvalid(lane, prBody);
    } catch (err) {
        console.warn(
            `land: could not classify the landing diff to check the check:ui receipt (${(err as Error).message}) — proceeding as if it is not a skin diff`
        );
        return false;
    }
}

// Computed from this FILE's directory for the same reason `GATE` is, below.
const PR_MERGE = resolve(__dirname, "pr-merge.ts");
const HEALTH_MAIN = resolve(__dirname, "health-main.ts");

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

// The checkout that owns `.git/` — where `green-sha` lives and worktree
// teardown runs from, never the linked worktree `land` is invoked from —
// used to be a private copy of this exact test; now the shared resolver
// (issue #2519, folded in by #2656) so there is one authority instead of two
// drifting in parallel.

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
    /**
     * true only when the landing diff classifies `skin` (`check-lane.ts`'s
     * `classifyLane`) AND its pasted `check:ui` receipt fails
     * `verifyReceiptText` (issue #2760) — a `check:ui` receipt is the whole
     * enforcement for a diff that can change what a user sees (the lane
     * stays outside `check:all` by contract, and there is no CI), so a
     * fabricated or truncated paste must block the merge the same way a red
     * gate does. false for a non-`skin` diff, or a `skin` diff whose receipt
     * verified clean — `land` owes this check nothing in either case.
     */
    skinReceiptInvalid: boolean;
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
    if (facts.skinReceiptInvalid) {
        return (
            "landing diff is `skin` and its pasted check:ui receipt failed verification " +
            "— re-run `bun run verify:ui-receipt <PR#>` for the mismatch, and paste a real full-lane receipt"
        );
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

/**
 * Shell fragment that fails the WHOLE locked command (before `green-sha` is
 * written) unless `origin/main` advanced by EXACTLY one commit — our squash
 * — between the `OLD_TIP` capture below and this point. The gate mutex is
 * machine-wide only; it says nothing about a push landing from a different
 * machine, or a human pushing straight to `main`, while this session held
 * the lock. Re-derives the log rather than caching it so the message on
 * failure shows exactly what landed.
 *
 * Brace-grouped as ONE command (`{ TEST || BLOCK; }`), not spliced bare into
 * the surrounding `&&` chain (review round 3): `&&`/`||` are equal-precedence
 * and left-associative, so an UNGROUPED `… && TEST || BLOCK && …` lets a
 * failure anywhere EARLIER in the chain (e.g. `check:all` going red) skip
 * every `&&`-joined step up to here and then run `BLOCK` anyway — the whole
 * gate-red case misreports itself as "refusing to record green-sha" instead
 * of surfacing the real failure. `rebaseStep()` above hits the identical
 * hazard with its own `||` and groups with `(…)` for the same reason.
 */
const VERIFY_MERGED_TIP =
    "{ " +
    '[ "$(git log --oneline "$OLD_TIP..origin/main" | wc -l | tr -d " ")" = "1" ] || ' +
    '{ echo "land: origin/main advanced by more than our squash between fetch and merge — refusing to record green-sha" >&2; ' +
    'git log --oneline "$OLD_TIP..origin/main" >&2; exit 1; }; ' +
    "}";

/**
 * Unsets `GITHUB_TOKEN` inside the locked shell ITSELF — see the CREDENTIALS
 * header comment for why `lockedEnv()` alone cannot reach this: `sh` never
 * reads `.env.local`, so this is the one point in the pipeline the bug-report
 * PAT cannot re-populate (review round 3, B1).
 */
const UNSET_GITHUB_TOKEN = "unset GITHUB_TOKEN";

/**
 * Delete the remote head branch, wrapped so it can never gate `land`'s exit
 * status (ref cleanup is cosmetic, see the header comment) — but distinguish
 * the DIAGNOSTIC by what git actually says (issue #2877). Since the repo
 * turned on "Automatically delete head branches" (2026-08-27), GitHub already
 * removes the head branch as part of the merge itself, before this step
 * runs, so `git push origin --delete` on an already-gone branch is now the
 * COMMON case, not a failure — but the raw command still writes
 * `error: unable to delete '<branch>': remote ref does not exist` +
 * `error: failed to push some refs to '<remote>'` to stderr even though its
 * exit code is already swallowed, and two `error:` lines at the tail of
 * every green land trains the reader to stop reading exactly the lines that
 * matter when a branch genuinely gets left behind.
 *
 * Captures the command's own combined output and re-emits it to stderr only
 * when it does NOT contain the one line only the already-gone case produces
 * — a real failure (auth, network, a branch that still has an open PR
 * pointing at it, …) says something else and must still surface. This reads
 * git's own behaviour, not a hand-maintained failure taxonomy: any error
 * that isn't literally "the ref was already gone" is treated as real.
 */
export function remoteBranchDeleteStep(branch: string): string {
    const q = shQuote(branch);
    return (
        `(out=$(git push origin --delete ${q} 2>&1); code=$?; ` +
        `if [ "$code" -ne 0 ] && ! printf '%s' "$out" | grep -q "remote ref does not exist"; then ` +
        `printf '%s\\n' "$out" >&2; ` +
        `fi; true)`
    );
}

/**
 * Fast-forward the PRIMARY checkout's local `main` onto the merged tip.
 *
 * `pr-merge.ts` lands the squash through the GitHub API, so nothing local
 * moves: the locked shell re-fetches `origin/main` (shared across every
 * linked worktree, same object store), but the primary checkout's own `main`
 * BRANCH ref stays where it was. The observable symptom is that after a green
 * `land` the checkout every session starts from reports `[behind 1]`, and the
 * next session's `git worktree add` branches off a tip that is already stale —
 * which is how a rebase conflict gets manufactured out of nothing.
 *
 * Guarded on the primary checkout actually having `main` CHECKED OUT, and
 * `--ff-only` on top of that. Without the guard a `git merge --ff-only
 * origin/main` would fast-forward whatever OTHER branch happens to be checked
 * out there — silently moving a user's work-in-progress branch onto main's
 * tip, which is exactly the class of surprise ref cleanup must never cause.
 *
 * Non-gating like the rest of the post-merge housekeeping (`; true`): the PR
 * is already merged, and a dirty tree or a detached HEAD in the primary
 * checkout must not turn a landed PR into a reported failure. It says so on
 * stderr instead, because a stale local `main` the user does not know about is
 * worse than one they were told to pull.
 */
export function primaryMainFastForwardStep(primaryCheckout: string): string {
    const p = shQuote(primaryCheckout);
    return (
        `(if [ "$(git -C ${p} symbolic-ref --quiet --short HEAD)" = "main" ]; then ` +
        `git -C ${p} merge --ff-only -q origin/main || ` +
        `echo "land: could not fast-forward local main in ${primaryCheckout} to the merged tip — pull it by hand" >&2; ` +
        `else echo "land: ${primaryCheckout} is not on main — local main left as it was" >&2; fi; true)`
    );
}

export function buildLockedCommand(opts: LockedCommandOptions): string {
    // The LANE gate, not the full gate (ADR 0110): `check:lane` runs exactly
    // the checks the classified diff owes (degrading to `check:pr` verbatim
    // on anything it cannot place), and the FULL gate moves post-merge — the
    // `health:main` detach below gates the merged tip in its own worktree.
    // Rationale and the incident that showed per-PR full gates did not keep
    // `main` green under concurrency anyway: ADR 0110 §3.
    const steps: string[] = [
        UNSET_GITHUB_TOKEN,
        rebaseStep(),
        "bun run check:lane",
        `git push --force-with-lease origin ${shQuote(opts.branch)}`,
    ];
    if (opts.merge) {
        // No `--delete-branch` — see the CREDENTIALS/MERGE VERIFICATION +
        // REF CLEANUP header comment for why, and why ref cleanup is pushed
        // to the end, past the green-sha write, each step wrapped so it
        // cannot gate `land`'s exit status.
        steps.push("OLD_TIP=$(git rev-parse origin/main)");
        // NOT a bare `gh pr merge`: the force-push above invalidates GitHub's
        // cached view of the PR, and the merge is refused while that
        // recomputes — twice on 2026-08-18, on trees that had not changed
        // (#2536). `pr-merge.ts` polls that window out and retries a
        // transient refusal WITHOUT re-running the gate; a real conflict
        // still fails loudly. It stays inside this string, hence inside the
        // one lock, for the reason the merge was put here at all.
        steps.push(`bun ${shQuote(PR_MERGE)} ${opts.pr}`);
        // `gh pr merge` lands via the API — it does not update this worktree's
        // local `origin/main`, so re-fetch before reading the new tip.
        steps.push("git fetch origin main -q");
        steps.push(VERIFY_MERGED_TIP);
        const greenSha = join(opts.primaryCheckout, GREEN_SHA_REL);
        steps.push(`mkdir -p ${shQuote(dirname(greenSha))}`);
        steps.push(`git rev-parse origin/main > ${shQuote(greenSha)}`);
        // Post-merge health gate (ADR 0110): detach the FULL gate on the
        // merged tip. Non-gating (`|| true`) — a merged PR's landing never
        // fails on it; the verdict lands in `.claude/telemetry/health/`
        // (`bun run health:status`). `env -u` scrubs the lock hold this
        // locked shell exports, so the health gate QUEUES on the machine
        // mutex like any other heavy gate instead of free-riding a hold that
        // is released the moment this shell exits.
        const healthDir = join(
            opts.primaryCheckout,
            ".claude/telemetry/health"
        );
        steps.push(`mkdir -p ${shQuote(healthDir)}`);
        // `|| true` stays INSIDE the outer parens: a bare `… && (X &) || true`
        // step would launder every earlier failure in the `&&` chain (the
        // VERIFY_MERGED_TIP precedence bug, review round 3 — the guarding
        // test caught this exact shape being reintroduced here).
        steps.push(
            `((cd ${shQuote(opts.primaryCheckout)} && nohup env -u TOLARIA_GATE_HELD -u TOLARIA_ALLOW_FULL_SUITE bun ${shQuote(HEALTH_MAIN)} >> ${shQuote(join(healthDir, "detach.log"))} 2>&1 &) || true)`
        );
        // Local `main` catches up with the tip the API merge just created —
        // unconditional of `--keep`, which is about the WORKTREE, not about
        // leaving the checkout every session branches from one commit stale.
        steps.push(primaryMainFastForwardStep(opts.primaryCheckout));
        // Ref cleanup — cosmetic, not gating. `(… || true)` so a failure here
        // (stale remote state, an already-deleted branch, …) can never turn
        // a MERGED PR's landing into a reported failure.
        //
        // ALL of it sits behind `--keep`, the remote ref included (#2536):
        // deleting the upstream of a worktree the user asked to keep leaves
        // that worktree's branch with no remote to push to — teardown means
        // teardown, and `--keep` means none of it.
        if (opts.teardown) {
            steps.push(remoteBranchDeleteStep(opts.branch));
            steps.push(
                `(git -C ${shQuote(opts.primaryCheckout)} worktree remove --force ${shQuote(opts.worktree)} || true)`
            );
            steps.push(
                `(git -C ${shQuote(opts.primaryCheckout)} branch -D ${shQuote(opts.branch)} || true)`
            );
        }
    }
    return steps.join(" && ");
}

// ─────────────────────────────────────────────────────────────────────────
// The locked child's environment — pure function of a base env so a test can
// assert on it without touching real `process.env`.
// ─────────────────────────────────────────────────────────────────────────

/**
 * `GITHUB_TOKEN` stripped (see `netEnv` / the CREDENTIALS header comment —
 * without this the embedded `gh pr merge` 403s under the server-side
 * bug-report PAT bun auto-loads from `.env.local`), `GH_TOKEN` left alone,
 * plus `TOLARIA_ALLOW_FULL_SUITE=1` so the issue-worktree guard
 * (`gate.ts:97-123`) does not refuse the heavy tier on the `fix/issue-N` /
 * `feat/issue-N` branch `land` runs from — `land` IS the merge-train, the
 * case that guard exempts.
 */
export function lockedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...netEnv(base), TOLARIA_ALLOW_FULL_SUITE: "1" };
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
    let prBody = "";
    try {
        const raw = gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state,headRefName,body",
        ]);
        const info = JSON.parse(raw) as {
            state: string;
            headRefName: string;
            body: string;
        };
        prState = info.state;
        prHeadRefName = info.headRefName;
        prBody = info.body;
    } catch {
        // leave both null — refusalReason reports "PR not found"
    }

    // The receipt check only applies to a `skin` landing diff (issue #2760)
    // — `check:ui` is the whole enforcement for a diff that can change what
    // a user sees, and does nothing for engine/full diffs. Computed even
    // when the PR wasn't found: `refusalReason` checks `prState` first and
    // short-circuits before this ever matters. `safeSkinReceiptInvalid`
    // tolerates a diff-classification failure (finding 6) instead of
    // crashing `land` before any refusal check runs.
    const skinReceiptInvalid = safeSkinReceiptInvalid(cwd, prBody);

    const reason = refusalReason({
        branch,
        dirty,
        prState,
        prHeadRefName,
        skinReceiptInvalid,
    });
    if (reason) fail(`refusing — ${reason}`);

    const primary = primaryCheckout(cwd);

    // Post-merge health verdict (ADR 0110): a RED marker means the full gate
    // found `main` broken after an earlier merge. Landing is still allowed —
    // the fix-forward that repairs `main` arrives through a `land` — but
    // nobody should stack new work on a red tip without knowing.
    if (existsSync(join(primary, ".claude/telemetry/health/RED"))) {
        console.warn(
            "land: WARNING — the post-merge health gate is RED on main (`bun run health:status`). Fixing main comes before landing unrelated work."
        );
    }

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
        env: lockedEnv(process.env),
    });
    process.exit(result.status ?? 1);
}

if (import.meta.main) {
    main();
}
