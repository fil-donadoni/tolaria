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
 * LANE SKIP (ADR 0136 §2, issue #3779). The lane is paid here and nowhere
 * else — there is no pre-PR gate — but a tree already gated green need not
 * pay it twice: a `land` retried after a transient merge refusal, or a
 * hand-run `gate:run check:lane` on a tree that was already rebased. The
 * locked command compares the REBASED tip and the base tip against the
 * (head, base) pairs recorded green (`gate-run.sh`'s run dirs, and the record
 * `land` itself writes after its own green lane) and prints `lane: ran` or
 * `lane: skipped (gated <sha> against <base>)`. Any mismatch runs the lane.
 *
 * BATCH HEALTH (ADR 0136 §6, issue #3780). A landing pays the LANE gate and
 * nothing else, but it is also what COUNTS toward the full gate: the locked
 * command records the merged tip in `.claude/telemetry/health/cadence.json`
 * and then detaches `health-cadence.ts detach`, which fires `health-main.ts`
 * after the 5th landing since the last GREEN or 2 h after the first
 * un-healthed one. Both steps are non-gating, and the detached run takes the
 * mutex through `gate.ts yield`, so it steps aside for any `land` queued
 * behind this one.
 *
 * Usage:
 *   bun run land <PR#>              fetch → rebase → gate → push → merge
 *   bun run land <PR#> --no-merge   …but stop after the push (leave PR open)
 *   bun run land <PR#> --keep       …merge, but skip worktree teardown
 */
import { spawnSync } from "node:child_process";
import { BASE_BRANCH, ORIGIN_BASE, RELEASE_BRANCH } from "./lib/branches";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gh, netEnv } from "./lib/gh";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    LIVE_ORIGIN_BAND_DEPS,
    originBandOfIssue,
    type OriginBand,
    type OriginBandDeps,
} from "./lib/origin-band";
import type { BoardPriority } from "./lib/board-priority";
import {
    classifyScenarioSection,
    owesScenario,
    scenarioRefusal,
} from "./lib/scenario-block";
import { changedPaths, classifyLane, type Lane } from "./check-lane";
import {
    landingDiffScope,
    verifyReceiptText,
    type ExpectedScope,
} from "./ui-gate/verify-receipt.ts";
import type { UiScope } from "./lib/ui-scope.ts";
import { changedRetiredRows, retirementRefusal } from "./lib/retirement-ack";
import { REGENERATE_MARKER } from "./lib/generated-artifacts";

/**
 * The one DECISION `land` makes about a `check:ui` receipt (issue #2760),
 * pulled out as a pure function per this file's own convention (git/gh
 * plumbing stays thin and untested; every decision is testable directly) —
 * `main()` only supplies the two impure inputs (the classified lane, the PR
 * body text).
 *
 * `expected` is the scope re-derived from the landing diff (issue #3628): a
 * `SCOPED` receipt is valid only against it, a full `RECEIPT` against any.
 */
export function computeSkinReceiptInvalid(
    lane: Lane,
    prBody: string,
    expected: ExpectedScope | null = null
): boolean {
    return lane === "skin" && !verifyReceiptText(prBody, expected).ok;
}

/**
 * The receipt decision for a landing diff given as paths, with `root` the
 * tree those paths live in. The scope is derived only for a `skin` diff that
 * owes a receipt — the import graph costs nothing on any other landing.
 */
export function skinReceiptInvalidForDiff(
    paths: string[],
    root: string,
    prBody: string,
    scopeOf: (changed: string[], root: string) => UiScope = landingDiffScope
): boolean {
    const lane = classifyLane(paths).lane;
    if (lane !== "skin" || isTestOnlySrcDiff(paths)) return false;
    // A scope that cannot be derived demands the FULL receipt. It must never
    // reach `safeSkinReceiptInvalid`'s catch, which reads "not a skin diff"
    // and would demand no receipt at all (issue #3628 review).
    let scope: UiScope;
    try {
        scope = scopeOf(paths, root);
    } catch (err) {
        scope = {
            kind: "full",
            reason: `scope unavailable: ${(err as Error).message}`,
        };
    }
    return computeSkinReceiptInvalid(lane, prBody, {
        base: ORIGIN_BASE,
        scope,
    });
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
 * `classifyLane(changedPaths(ORIGIN_BASE, cwd, true))` plus
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
        const paths = changedPaths(ORIGIN_BASE, cwd, true);
        return skinReceiptInvalidForDiff(paths, cwd, prBody);
    } catch (err) {
        console.warn(
            `land: could not classify the landing diff to check the check:ui receipt (${(err as Error).message}) — proceeding as if it is not a skin diff`
        );
        return false;
    }
}

/**
 * The preset-scenario refusal (ADR 0044), computed the same tolerant way
 * `safeSkinReceiptInvalid` is: a diff-classification failure must not crash
 * `land` before any refusal check runs, so it degrades to "allow" and says so.
 *
 * WHY THIS IS A GATE AT ALL. CLAUDE.md § Development cycle step 7 has always
 * required one scenario per new card/gameplay feature, and routed the insert
 * to "the orchestrator, post-merge". ADR 0110 retired the orchestrator and
 * `/next-issue` never inherited the step, so the requirement survived only as
 * prose — and prose is not where invariants live (CLAUDE.md § Skills). Over
 * the 200 merged PRs before this landed, 42 carried a spec that was never
 * registered anywhere and 17 shipped a gameplay diff with no block and no
 * decline. Both halves are what this refusal and `seed:scenario` close.
 */
export function safeScenarioRefusal(
    cwd: string,
    prBody: string
): string | null {
    const verdict = classifyScenarioSection(prBody);
    let owes = false;
    try {
        owes = owesScenario(changedPaths(ORIGIN_BASE, cwd, true));
    } catch (err) {
        console.warn(
            `land: could not classify the landing diff to check the preset scenario (${(err as Error).message}) — only a malformed block can refuse`
        );
    }
    return scenarioRefusal(verdict, owes);
}

/**
 * The retirement-marker refusal (issue #3049, ADR 0114 §1), computed the same
 * tolerant way the two above are: a git failure must not crash `land` before
 * any refusal check runs.
 *
 * WHY THIS IS A GATE. A retired card's lockfile row is the only copy of its
 * behaviour — the hand-written module is gone, and nobody reads a file that no
 * longer exists. `check:oracle` proves the row is what the compiler produces
 * and that the marker is not a lie; neither it nor Guard C asks whether a human
 * LOOKED at a marked row changing, which is the one thing that cannot be
 * derived offline. So the PR body carries it, exactly as it carries the preset
 * scenario and the `check:ui` receipt.
 *
 * `-U0` and `origin/main...HEAD` match `changedPaths`: the lockfile's one-row-
 * per-line serializer is what makes a line-oriented scan exact.
 */
export function safeRetirementRefusal(
    cwd: string,
    prBody: string
): string | null {
    let diff = "";
    try {
        diff = git(
            [
                "diff",
                "-U0",
                `${ORIGIN_BASE}...HEAD`,
                "--",
                "data/oracle-compiled.json",
            ],
            cwd
        );
    } catch (err) {
        console.warn(
            `land: could not diff the lockfile to check retirement markers (${(err as Error).message}) — proceeding as if it touches none`
        );
        return null;
    }
    return retirementRefusal(changedRetiredRows(diff), prBody);
}

// Computed from this FILE's directory for the same reason `GATE` is, below.
const PR_MERGE = resolve(__dirname, "pr-merge.ts");
/**
 * The batch-health driver, named RELATIVE to the primary checkout — both steps
 * that use it `cd` there first.
 *
 * NOT `resolve(__dirname, …)` like the constants around it, and that is the
 * whole point. `__dirname` is the WORKTREE `land` runs from, and the worktree
 * is torn down by this very command; the detach step ran after that teardown
 * and died with `Module not found ".../tolaria-issue-3780/scripts/health-cadence.ts"`
 * on the first real landing. Its sibling constants are safe only because their
 * steps happen to run before the teardown — a property of step ORDER, not of
 * the path. The primary checkout is where the merged code lives and where the
 * detached decision must keep reading from long after this worktree is gone.
 */
const HEALTH_CADENCE_REL = "scripts/health-cadence.ts";
const SEED_SCENARIO = resolve(__dirname, "seed-scenario.ts");
const RESOLVE_ARTIFACTS = resolve(__dirname, "resolve-generated-artifacts.ts");
const GAPS_SYNC = resolve(__dirname, "gaps-sync.ts");

// Computed the same way scripts/__tests__/gate.test.ts computes it (from a
// FILE's own directory, not from `import.meta.dir`, which is bun-only and
// would throw when this module is imported under vitest for its pure
// functions).
const GATE = resolve(__dirname, "gate.ts");

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
    /** `gh pr view --json baseRefName`; null when the PR was not found. */
    prBaseRefName: string | null;
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
    /**
     * Refusal string from `safeScenarioRefusal` (ADR 0044), or null. Set when
     * the landing diff owes a preset scenario and the PR body carries none,
     * or when it carries one that does not load. See that function for why
     * this is a gate rather than a line of prose.
     */
    scenarioRefusal: string | null;
    /**
     * Refusal string from `safeRetirementRefusal` (issue #3049, ADR 0114 §1),
     * or null. Set when the landing diff changes a lockfile row whose card has
     * no hand-written definition left and the PR body does not name that card.
     */
    retirementRefusal: string | null;
}

/**
 * What this `land` invocation is FOR (issue #4159).
 *
 * `full` — the ordinary landing: rebase, lane gate, push, merge, housekeeping.
 * `housekeeping` — the PR is ALREADY MERGED, so the only work left is the
 * post-merge step list, which the `pr-merge` recovery path cannot run. Keyed
 * on the PR state alone and nothing else: the state is the one fact that says
 * whether a merge still has to happen, and deriving the mode from a flag the
 * caller passes would let a session ask for a merge-free `land` on an OPEN PR
 * — which is `--no-merge`, a different thing entirely.
 */
export type LandMode = "full" | "housekeeping";

export function landMode(prState: string | null): LandMode {
    return prState === "MERGED" ? "housekeeping" : "full";
}

/**
 * Named refusal reason, or null when `land` may proceed. Checked cheapest /
 * most-fundamental first, so a session that is on `main` (or dirty) never
 * pays for a `gh pr view` round trip it could never have used anyway.
 *
 * A MERGED PR is not a refusal any more (issue #4159): it selects the
 * housekeeping mode. The structural facts still apply to it — a dirty tree
 * would be destroyed by the teardown, and a PR merged into some OTHER base
 * must not drag the primary checkout's base branch around — but the three
 * BODY facts below do not: they are PRE-merge gates (does this diff owe a
 * `check:ui` receipt, a preset scenario, a retirement note?) and re-asking
 * them after the merge could only refuse to clean up after a PR that is
 * already on the base branch, which is the silence this issue removes.
 */
export function refusalReason(facts: LandFacts): string | null {
    if (facts.branch === BASE_BRANCH || facts.branch === RELEASE_BRANCH) {
        return `on \`${facts.branch}\` — land runs from the PR's own branch, never from \`${BASE_BRANCH}\` or \`${RELEASE_BRANCH}\``;
    }
    if (facts.dirty) {
        return "working tree is dirty — commit or stash before landing";
    }
    if (facts.prState === null) {
        return "PR not found";
    }
    const mode = landMode(facts.prState);
    if (mode === "full" && facts.prState !== "OPEN") {
        return `PR is not open (state: ${facts.prState})`;
    }
    if (facts.prHeadRefName !== facts.branch) {
        return `PR head branch (${facts.prHeadRefName}) does not match the current branch (${facts.branch})`;
    }
    if (facts.prBaseRefName !== BASE_BRANCH) {
        // The API merge lands on whatever base the PR declares. A PR opened
        // against the release branch (a stale habit, or a `gh pr create`
        // run before the default branch moved) would ship to production
        // unreleased — refuse before the lock, and name the one-line fix.
        //
        // The EXIT differs by mode, and only the full path has one: `gh pr
        // edit --base` is a no-op on a PR that has already merged, so telling
        // a housekeeping caller to retarget would be advice it cannot take.
        // What it needs instead is to know the housekeeping is not `land`'s
        // to run — the fast-forward and the ledger are about THIS base branch,
        // and the merge went somewhere else.
        const head = `PR targets \`${facts.prBaseRefName}\` — land merges only into the base branch \`${BASE_BRANCH}\` (tolaria.config.json)`;
        return mode === "housekeeping"
            ? `${head}; it has already merged there, so its post-merge housekeeping is not \`${BASE_BRANCH}\`'s to run`
            : `${head}; retarget with \`gh pr edit <PR#> --base ${BASE_BRANCH}\``;
    }
    if (mode === "housekeeping") return null;
    if (facts.skinReceiptInvalid) {
        return (
            "landing diff is `skin` and its pasted check:ui receipt failed verification " +
            "— every verdict line must be PASS and the verdict block must match the one re-derived from the diff's scope; " +
            "`bun run verify:ui-receipt <PR#>` names the problem"
        );
    }
    if (facts.scenarioRefusal) {
        return facts.scenarioRefusal;
    }
    if (facts.retirementRefusal) {
        return facts.retirementRefusal;
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
        `git fetch origin ${BASE_BRANCH} && ` +
        `(git rebase ${ORIGIN_BASE} || ` +
        "{ git --no-pager diff --name-only --diff-filter=U; git rebase --abort; " +
        // Clear the regenerate marker ONLY on the abort path. `--abort`
        // restores the pre-rebase tree, so anything the merge driver marked
        // during this attempt is moot. Clearing it BEFORE the rebase instead
        // would erase a debt from a rebase or merge the developer ran BY HAND —
        // the driver is registered in local config and fires there too, and
        // that side-taken artifact would then land with nothing to catch it
        // (review of issue #3069).
        `rm -f "$(git rev-parse --git-path ${REGENERATE_MARKER})"; ` +
        "exit 1; })"
    );
}

/**
 * Re-derive any generated artifact the `merge=regenerated` driver took a side
 * of during the rebase, ONCE, at the rebased tip — the second half of "a
 * generated artifact is regenerated, not merged" (issue #3069).
 *
 * Sits between the rebase and `check:lane` because the whole point is that the
 * tree the LANE GATE sees is the tree a fresh regeneration produces; running it
 * after the gate would gate a tree nobody ships. A no-op (exit 0, no output) on
 * every landing where nothing conflicted, which is nearly all of them.
 */
export function resolveGeneratedArtifactsStep(): string {
    return `bun ${shQuote(RESOLVE_ARTIFACTS)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// The locked command — everything that runs inside the ONE `gate.ts heavy`
// invocation. Built as a literal shell string (never a re-invocation of
// `land.ts` itself) precisely so a test can assert the merge — and the push,
// and the gate steps — are textually inside it: the lock cannot be escaped
// by a step that never appears in the string the lock wraps.
// ─────────────────────────────────────────────────────────────────────────

/**
 * What the post-merge housekeeping needs, and nothing more (issue #4159).
 *
 * Its own interface rather than a slice of `LockedCommandOptions`, because the
 * recovery entry point has no gate to run and therefore no `gatedGreen` /
 * `laneRecordDir` / `merge` to speak of — and a housekeeping step that started
 * reading one of those would be a step the recovery path could not run.
 */
export interface HousekeepingOptions {
    branch: string;
    pr: number;
    /** The main checkout — where green-sha lives and teardown runs from. */
    primaryCheckout: string;
    /** The worktree `land` runs from — removed on teardown. */
    worktree: string;
    /** false for `--keep`: skip worktree teardown after a successful merge. */
    teardown: boolean;
    /**
     * The priority band of the issue this branch closes (issue #4158), passed
     * to `gaps:sync --band`. Omitted / null when it could not be determined.
     *
     * Housekeeping, not gating (issue #4159): `gapsSyncStep` is in the shared
     * post-merge list, so the recovery path needs this as much as the landing
     * path does — a gap filed by a recovery run must land under the same
     * umbrella it would have under `land`.
     */
    originBand?: BoardPriority | null;
}

export interface LockedCommandOptions extends HousekeepingOptions {
    /**
     * The (head, base) pairs a `check:lane` run was recorded green on — read
     * BEFORE the lock by `readGreenLaneRuns`. The locked command skips the
     * lane when the rebased tip and the base tip match one of them. `[]`
     * always runs the lane.
     */
    gatedGreen: GreenLaneRun[];
    /**
     * Where `land` records its own green lane, in the `gate-run.sh` record
     * format, so a retried `land` of the same tree skips it; null writes none.
     */
    laneRecordDir: string | null;
    /** false for `--no-merge`: gate and push, never merge. */
    merge: boolean;
}

function shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ─────────────────────────────────────────────────────────────────────────
// Lane skip — the (tip, base) a lane was already gated green on (ADR 0136 §2)
// ─────────────────────────────────────────────────────────────────────────

/** One green `check:lane` run: the HEAD it gated and the base tip it ran against. */
export interface GreenLaneRun {
    head: string;
    base: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * Where `gate-run.sh` keeps its run dirs — the same default and the same
 * override (`TOLARIA_GATE_RUN_DIR`) as that script's `RUN_ROOT`.
 */
export function gateRunRoot(env: NodeJS.ProcessEnv): string {
    if (env.TOLARIA_GATE_RUN_DIR) return env.TOLARIA_GATE_RUN_DIR;
    const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache");
    return join(cache, "tolaria", "gate-runs");
}

/**
 * A run dir's record, as a green lane run, or null. Only EXACTLY
 * `check:lane` counts — a green `check:lane --base=<ref>` classified against
 * another base, and a green `land` or `test:app`, say nothing about the lane
 * this tree owes. Both shas must be full hex: they are spliced into the
 * locked shell string, and anything else can never match a `git rev-parse`.
 */
export function greenLaneRunOf(files: {
    command: string | null;
    head: string | null;
    base: string | null;
    green: boolean;
}): GreenLaneRun | null {
    if (!files.green || files.command?.trim() !== "check:lane") return null;
    const head = files.head?.trim() ?? "";
    const base = files.base?.trim() ?? "";
    if (!FULL_SHA.test(head) || !FULL_SHA.test(base)) return null;
    return { head, base };
}

/** Every green lane run under `root`. Thin fs plumbing; never throws. */
export function readGreenLaneRuns(root: string): GreenLaneRun[] {
    const read = (f: string): string | null => {
        try {
            return readFileSync(f, "utf8");
        } catch {
            return null;
        }
    };
    let dirs: string[];
    try {
        dirs = readdirSync(root);
    } catch {
        return [];
    }
    const runs: GreenLaneRun[] = [];
    for (const d of dirs) {
        const dir = join(root, d);
        const run = greenLaneRunOf({
            command: read(join(dir, "command")),
            head: read(join(dir, "head")),
            base: read(join(dir, "base")),
            green: existsSync(join(dir, "green")),
        });
        if (run) runs.push(run);
    }
    return runs;
}

/**
 * The lane step of the locked command. It runs AFTER the rebase and the
 * artefact regeneration (which amends the tip when it changes anything, so a
 * regenerated tree has a new sha and cannot match), so `HEAD` here is the tree
 * that lands. Skips only on a clean tree whose (tip, base) equals a recorded
 * green pair; otherwise runs `check:lane` and, on green, records the pair for
 * a retried `land` of the same tree.
 *
 * The record write is non-gating (`|| true`, grouped so it can never swallow
 * the lane's own red): a cache dir that cannot be written costs a re-gate
 * next time, never a failed landing. `green` is removed before `head`/`base`
 * are rewritten, the same ordering `gate-run.sh` keeps.
 */
export function laneStep(
    gatedGreen: GreenLaneRun[],
    laneRecordDir: string | null
): string {
    const pairs = gatedGreen
        .filter((r) => FULL_SHA.test(r.head) && FULL_SHA.test(r.base))
        .map((r) => `'${r.head} ${r.base}'`);
    const record =
        laneRecordDir === null
            ? ""
            : (() => {
                  const d = shQuote(laneRecordDir);
                  return (
                      ` && { (mkdir -p ${d} && rm -f ${d}/green && ` +
                      `printf '%s\n' "$LANE_TIP" >${d}/head && ` +
                      `printf '%s\n' "$LANE_BASE" >${d}/base && ` +
                      `printf 'check:lane\n' >${d}/command && : >${d}/green) 2>/dev/null || true; }`
                  );
              })();
    const run = `echo "lane: ran" && bun run check:lane${record}`;
    const matches =
        pairs.length === 0
            ? "false"
            : `case "$LANE_TIP $LANE_BASE" in ${pairs.join("|")}) true;; *) false;; esac`;
    return (
        "{ " +
        `LANE_TIP=$(git rev-parse HEAD) && LANE_BASE=$(git rev-parse ${ORIGIN_BASE}) && ` +
        `if [ -z "$(git status --porcelain)" ] && ${matches}; then ` +
        `echo "lane: skipped (gated $LANE_TIP against $LANE_BASE)"; ` +
        `else ${run}; fi; ` +
        "}"
    );
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
    `[ "$(git log --oneline "$OLD_TIP..${ORIGIN_BASE}" | wc -l | tr -d " ")" = "1" ] || ` +
    `{ echo "land: ${ORIGIN_BASE} advanced by more than our squash between fetch and merge — refusing post-merge housekeeping" >&2; ` +
    `git log --oneline "$OLD_TIP..${ORIGIN_BASE}" >&2; exit 1; }; ` +
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
export function primaryBranchFastForwardStep(
    primaryCheckout: string,
    branch: string = BASE_BRANCH
): string {
    const p = shQuote(primaryCheckout);
    return (
        `(if [ "$(git -C ${p} symbolic-ref --quiet --short HEAD)" = "${branch}" ]; then ` +
        `git -C ${p} merge --ff-only -q origin/${branch} || ` +
        `echo "land: could not fast-forward local ${branch} in ${primaryCheckout} to the merged tip — pull it by hand" >&2; ` +
        `else echo "land: ${primaryCheckout} is not on ${branch} — local ${branch} left as it was" >&2; fi; true)`
    );
}

/**
 * The issue a branch claims, by the `feat|fix|<kind>/issue-N` naming every
 * worktree here is built with (`wt:new`), or null for any other branch.
 */
export function issueOfBranch(branch: string): number | null {
    const m = /(?:^|\/)issue-(\d+)$/.exec(branch);
    return m ? Number(m[1]) : null;
}

/**
 * The origin band `gaps:sync --band` is told for `branch` (issue #4158): the
 * band of the issue the branch names, by the rule `queue:plan` orders by. A
 * branch naming no issue, or a band that cannot be read, is a null band and a
 * reason — never a throw: the sync is post-merge housekeeping. `deps` is the
 * test seam; the real reads are the default.
 */
export function originBandForBranch(
    branch: string,
    deps: OriginBandDeps = LIVE_ORIGIN_BAND_DEPS
): OriginBand {
    const issue = issueOfBranch(branch);
    if (issue === null)
        return { band: null, reason: `branch ${branch} names no issue` };
    return originBandOfIssue(issue, deps);
}

/**
 * Release the `in-progress` claim on the issue the landed branch names
 * (issue #3130). The claim is added at pick time and, before this, nothing
 * removed it on the success path: `claim-sweep.sh` runs at SessionEnd and
 * deliberately leaves a claim whose PR is open, `loop:doctor` sweeps OPEN
 * issues only, so an issue closed by its PR kept the label forever — 56 of
 * them on 2026-09-07. Non-gating like the rest of the housekeeping: a label
 * edit that fails must never turn a merged PR into a reported failure.
 * Returns null for a branch that names no issue.
 */
export function releaseClaimStep(branch: string): string | null {
    const issue = issueOfBranch(branch);
    if (issue === null) return null;
    return `(gh issue edit ${issue} --remove-label in-progress --remove-assignee @me >/dev/null 2>&1 || echo "land: could not release the in-progress claim on issue #${issue}" >&2; true)`;
}

/**
 * `gaps:sync` post-merge (ADR 0137, issue #3829) — files or reconciles one
 * issue per Grammar/Bot Gap allowlist row, "beside the preset-scenario
 * seeding [`land`] already does" (issue #3829). Runs in the PRIMARY
 * checkout, same as `SEED_SCENARIO` above and for the same reason: it must
 * see the merged tree, and `__dirname` still resolves into this worktree at
 * this point in the pipeline (before teardown — step ORDER, see
 * `HEALTH_CADENCE_REL`'s comment for the failure mode that happens when a
 * step like this one runs AFTER it instead).
 *
 * Non-gating like the rest of the post-merge housekeeping: a `gh` outage, a
 * rate limit or a network blip must never turn a merged PR into a reported
 * failure — the allowlist just stays stale until the next landing retries it.
 */
export function gapsSyncStep(
    primaryCheckout: string,
    originBand: BoardPriority | null = null
): string {
    const p = shQuote(primaryCheckout);
    // The ORIGIN band of the work just merged (issue #4158): a gap born of P0
    // work files under its family's P0 umbrella, which nothing computed can
    // reach. Derived by `originBandOfIssue` before the lock, from the issue the
    // branch names; absent when it could not be read — `gaps:sync` then keeps
    // its computed band, exactly as before.
    const band = originBand === null ? "" : ` --band ${originBand}`;
    return (
        `(cd ${p} && bun ${shQuote(GAPS_SYNC)}${band} || ` +
        `echo "land: gaps:sync failed — Grammar/Bot Gap issues may be stale" >&2; true)`
    );
}

/**
 * Record the landing in the batch-health ledger (ADR 0136 §6, issue #3780).
 *
 * The FULL gate runs per BATCH — after the 5th landing since the last GREEN,
 * or 2 h after the first un-healthed one — so something has to COUNT the
 * landings, and the only process that knows one happened is the one that
 * merged it. Synchronous, tiny (one JSON file), and in the PRIMARY checkout
 * where the rest of `.claude/telemetry/health/` lives; non-gating like every
 * other post-merge step, because a ledger write that fails must never turn a
 * merged PR into a reported failure.
 *
 * The sha recorded is the base tip the squash produced, read after the
 * post-merge re-fetch and past `VERIFY_MERGED_TIP` — so it is the tip this
 * landing actually created, not whatever the remote held at `land`'s start.
 */
export function recordLandingStep(primaryCheckout: string): string {
    return (
        `(cd ${shQuote(primaryCheckout)} && ` +
        `bun ${shQuote(HEALTH_CADENCE_REL)} record --sha="$(git rev-parse ${ORIGIN_BASE})" || ` +
        `echo "land: could not record the landing in the health ledger" >&2; true)`
    );
}

/**
 * Start the batch-health DECISION (ADR 0136 §6). Conditional inside the
 * script, not in the shell: `health-cadence detach` re-reads the ledger and
 * the CURRENT tip and holds unless a threshold tripped, so this step is one
 * cheap spawn per landing and the trigger logic stays where it is tested
 * (`lib/health-cadence.ts`) instead of half-living in a shell string.
 *
 * SYNCHRONOUS, and `spawn` rather than `nohup … &` — this is load-bearing and
 * was got wrong once. `gate.ts` runs this locked command `detached`, so the
 * `sh` around it leads its own process GROUP, and every teardown path (the
 * ordinary `exit` handler after a CLEAN child exit included) SIGKILLs that
 * whole group — `killChildTree`, issue #3821. `nohup` ignores SIGHUP and
 * redirects output; it does not leave the process group, and neither does
 * `&`. A health run backgrounded here therefore dies milliseconds later, with
 * `land` reporting a green landing: measured, the marker a backgrounded
 * `sleep 4` should have written never appeared. The batch gate would have
 * looked installed and done nothing, silently, for ever.
 *
 * So `land` calls `health-cadence.ts spawn`, which re-launches the decision
 * through node's `spawn(…, { detached: true })` — i.e. `setsid(2)`, a new
 * SESSION no group signal to `land`'s tree can reach — and returns. ~60 ms,
 * inside the lock, once per landing.
 *
 * `; true` so it can never gate the landing: the PR is already merged.
 */
export function healthDetachStep(primaryCheckout: string): string {
    return (
        `(cd ${shQuote(primaryCheckout)} && bun ${shQuote(HEALTH_CADENCE_REL)} spawn || ` +
        `echo "land: could not start the batch health decision" >&2; true)`
    );
}

/**
 * Register the PR's preset scenario in the local Convex deployment (ADR 0044)
 * — the step ADR 0110 dropped when it retired the orchestrator and CLAUDE.md
 * § step 7 still names. In the PRIMARY checkout (a linked worktree has no
 * `.env.local`, so no `CONVEX_DEPLOYMENT`), and NON-GATING like the rest of
 * the housekeeping: no local deployment, a stopped `convex dev` or a spec
 * naming a since-renamed card must never turn a merged PR into a reported
 * failure. The pre-merge `scenarioRefusal` is what actually enforces that a
 * spec EXISTS and loads; this only writes it.
 */
export function seedScenarioStep(primaryCheckout: string, pr: number): string {
    return `(cd ${shQuote(primaryCheckout)} && bun ${shQuote(SEED_SCENARIO)} ${pr} || true)`;
}

/**
 * What `land` does AFTER the merge has landed — extracted as ONE named list so
 * the recovery path can run exactly it (issue #4159).
 *
 * WHY IT IS ITS OWN FUNCTION. Every step below used to be pushed inline inside
 * `buildLockedCommand`, reachable only by running `land` from the top. When
 * the MERGE step failed, the documented recovery was `bun scripts/pr-merge.ts
 * <PR#>` and never a second `land` (which would re-pay the whole gate) — but
 * `pr-merge` only merges, so the recovery landed the PR and silently skipped
 * ALL of this. That is not a new failure mode: it is a regression path back
 * into issue #3253, whose whole finding was that an unseeded scenario is lost
 * in silence (10 of the 14 specs in 80 PRs never reached the deployment).
 * Observed on PR #4153 (2026-09-19): stale `CONFLICTING` right after `land`'s
 * own force-push, `pr-merge` retried alone, and the fast-forward, the seed and
 * `gaps:sync` never ran.
 *
 * RE-ENTRY IS SAFE, by construction rather than by hope — which is what lets
 * `land` run this list against an already-MERGED PR:
 *  - `recordLandingStep` → `recordLanding` is idempotent on the tip already at
 *    the tail of the ledger (`lib/health-cadence.ts`);
 *  - the fast-forward is `--ff-only` and guarded on the primary checkout being
 *    on the base branch;
 *  - the seed is upsert-by-label (`lib/seed-scenario-run.ts` constraint 2);
 *  - `gaps:sync` reconciles rather than appends;
 *  - the claim release, the ref cleanup and the teardown are all `|| true` and
 *    already no-ops once they have run.
 *
 * ORDER IS LOAD-BEARING and is asserted by the step-order tests, not by this
 * comment: fast-forward BEFORE the seed (issue #3253 — the seed resolves card
 * names server-side against the bundle it pushes from the primary checkout's
 * DISK, so seeding a pre-merge tree can never resolve the PR's own new card),
 * and the health detach BEFORE the teardown that removes the worktree this
 * command runs from.
 */
export function postMergeHousekeepingSteps(
    opts: HousekeepingOptions
): string[] {
    const steps: string[] = [
        // The landing counter the batch health gate reads (ADR 0136 §6). A
        // landing still pays the LANE gate only; the FULL gate runs once per
        // BATCH — five landings, or two hours — detached below, never inside
        // the lock.
        recordLandingStep(opts.primaryCheckout),
        // Local `main` catches up with the tip the API merge just created —
        // unconditional of `--keep`, which is about the WORKTREE, not about
        // leaving the checkout every session branches from one commit stale.
        //
        // BEFORE the seed below, and that order is load-bearing (issue #3253).
        // `seedScenarioDirect` resolves every card name SERVER-SIDE against
        // the deployed bundle, and the bundle can only ever contain what is on
        // DISK in the primary checkout. Seeding first meant seeding against
        // the PRE-merge tree, so a scenario naming the PR's own new card could
        // never resolve — not a race, an ordering bug, and it silently lost 10
        // of the 14 specs in the 80 PRs before 2026-09-09. The seed's own
        // `--push` (`lib/seed-scenario-run.ts`) is the other half: it deploys
        // what this fast-forward just wrote instead of waiting on a `convex
        // dev` watcher that may be seconds behind or not running at all.
        primaryBranchFastForwardStep(opts.primaryCheckout),
        seedScenarioStep(opts.primaryCheckout, opts.pr),
        // File/reconcile Grammar and Bot Gap issues (ADR 0137, issue #3829) —
        // beside the preset-scenario seeding just above, non-gating for the
        // same reason.
        gapsSyncStep(opts.primaryCheckout, opts.originBand ?? null),
    ];
    // The claim outlives nothing: the PR is merged, the issue is closing.
    const release = releaseClaimStep(opts.branch);
    if (release !== null) steps.push(release);
    // BEFORE the teardown below, which removes the worktree this command
    // runs from. `spawn` is synchronous and creates nothing but a process
    // — the health worktree is created minutes later, by the detached
    // decision, once it has the mutex — so there is nothing here to
    // contend with the `worktree remove`, and everything to lose by
    // running after it.
    steps.push(healthDetachStep(opts.primaryCheckout));
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
    return steps;
}

/**
 * The RECOVERY entry point (issue #4159): the post-merge housekeeping, and
 * nothing else, for a PR that merged OUTSIDE `land` — i.e. through the
 * documented `bun scripts/pr-merge.ts <PR#>` retry after `land`'s own merge
 * step lost the race with GitHub's post-force-push settle.
 *
 * NO rebase, NO `check:lane`, NO merge — the tree is already on the base
 * branch and re-paying the lane gate is the exact cost the `pr-merge` retry
 * exists to avoid (CLAUDE.md § Merging, ADR 0136 §2). What is left is the
 * housekeeping, which never ran.
 *
 * `git fetch` first, because everything downstream reads the MERGED tip:
 * `recordLandingStep` does `git rev-parse origin/<base>` and the fast-forward
 * merges `origin/<base>` into the primary checkout. In the `land` path that
 * fetch is the post-merge re-fetch; here nothing has fetched at all since the
 * merge landed through the API. `-q`, and NOT wrapped in `|| true`: a fetch
 * that fails means every tip below is stale, and recording a stale sha as this
 * landing's is worse than stopping.
 *
 * `UNSET_GITHUB_TOKEN` leads for the same reason it leads `buildLockedCommand`
 * — see the CREDENTIALS header comment; the `gh` call in the claim release is
 * downstream of it.
 */
export function buildHousekeepingCommand(opts: HousekeepingOptions): string {
    return [
        UNSET_GITHUB_TOKEN,
        `git fetch origin ${BASE_BRANCH} -q`,
        ...postMergeHousekeepingSteps(opts),
    ].join(" && ");
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
        resolveGeneratedArtifactsStep(),
        laneStep(opts.gatedGreen, opts.laneRecordDir),
        `git push --force-with-lease origin ${shQuote(opts.branch)}`,
    ];
    if (opts.merge) {
        // No `--delete-branch` — see the CREDENTIALS/MERGE VERIFICATION +
        // REF CLEANUP header comment for why, and why ref cleanup is pushed
        // to the end, past the green-sha write, each step wrapped so it
        // cannot gate `land`'s exit status.
        steps.push(`OLD_TIP=$(git rev-parse ${ORIGIN_BASE})`);
        // NOT a bare `gh pr merge`: the force-push above invalidates GitHub's
        // cached view of the PR, and the merge is refused while that
        // recomputes — twice on 2026-08-18, on trees that had not changed
        // (#2536). `pr-merge.ts` polls that window out and retries a
        // transient refusal WITHOUT re-running the gate; a real conflict
        // still fails loudly. It stays inside this string, hence inside the
        // one lock, for the reason the merge was put here at all.
        // `--from-land` silences `pr-merge`'s follow-up notice (issue #4159):
        // that notice exists for a HAND-RUN merge, and the housekeeping it
        // names is the very next thing this command does.
        steps.push(`bun ${shQuote(PR_MERGE)} ${opts.pr} --from-land`);
        // `gh pr merge` lands via the API — it does not update this worktree's
        // local `origin/main`, so re-fetch before reading the new tip.
        steps.push(`git fetch origin ${BASE_BRANCH} -q`);
        steps.push(VERIFY_MERGED_TIP);
        // Everything past the merge verification is the SHARED housekeeping
        // list (issue #4159) — the same steps, in the same order, that
        // `buildHousekeepingCommand` runs on its own when the merge happened
        // outside `land`. Never inline a step here: a step that exists in one
        // path and not the other is exactly the drift that made the `pr-merge`
        // recovery lose the seed in silence, and `land.test.ts` pins the two
        // lists as one string.
        steps.push(...postMergeHousekeepingSteps(opts));
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
    return {
        ...netEnv(base),
        TOLARIA_ALLOW_FULL_SUITE: "1",
        // What this caller IS, for the mutex's yield rule (ADR 0136 §6): the
        // batch health gate steps aside while any `land` is queued, and a
        // queued land is only recognisable as one because of this.
        TOLARIA_GATE_ROLE: "land",
    };
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
    let prBaseRefName: string | null = null;
    let prBody = "";
    try {
        const raw = gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state,headRefName,baseRefName,body",
        ]);
        const info = JSON.parse(raw) as {
            state: string;
            headRefName: string;
            baseRefName: string;
            body: string;
        };
        prState = info.state;
        prHeadRefName = info.headRefName;
        prBaseRefName = info.baseRefName;
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
    // ADR 0044 — the preset scenario, the other thing a PR body carries that
    // nothing else in the toolchain reads. Same tolerant shape.
    const scenarioProblem = safeScenarioRefusal(cwd, prBody);
    // ADR 0114 §1 — a marked lockfile row has no hand-written twin behind it,
    // so a change to one is reviewed rather than merely diffed. Same shape.
    const retirementProblem = safeRetirementRefusal(cwd, prBody);

    const reason = refusalReason({
        branch,
        dirty,
        prState,
        prHeadRefName,
        prBaseRefName,
        skinReceiptInvalid,
        scenarioRefusal: scenarioProblem,
        retirementRefusal: retirementProblem,
    });
    if (reason) fail(`refusing — ${reason}`);

    const primary = primaryCheckout(cwd);

    // Health verdict (ADR 0136 §6): a RED marker means the full gate found the
    // base tip broken — at the last `bun run release`, or at the batch gate
    // that now runs every five landings. RED refuses the next PICK
    // (`queue:plan`), never the LAND: the fix-forward that repairs the tip
    // arrives through a `land`, and a session already mid-issue must be able
    // to finish. It still says so, because nobody should stack new work on a
    // red tip without knowing.
    if (existsSync(join(primary, ".claude/telemetry/health/RED"))) {
        console.warn(
            `land: WARNING — the health gate is RED on \`${BASE_BRANCH}\` (\`bun run health:status\`). Fixing it comes before landing unrelated work.`
        );
    }

    // The RECOVERY mode (issue #4159): a PR that merged outside `land` — the
    // documented `bun scripts/pr-merge.ts <PR#>` retry after `land`'s own
    // merge step lost the post-force-push settle race — still owes every
    // post-merge step, and until now nothing could run them. It costs no lane
    // gate and no rebase: the tree is already on the base branch, and ADR 0136
    // §2's whole point is that a tree gated once is not gated again.
    //
    // Still inside `gate.ts heavy`, exactly like the full path: the seed
    // pushes the primary checkout's bundle and the fast-forward moves its base
    // branch, and those are the writes the machine-wide mutex exists to
    // serialise against another session's `land`.
    const mode = landMode(prState);

    // Read BEFORE the lock and the merge, while the issue is still open and the
    // board still shows it; non-gating — an unreadable band is a warning and a
    // `gaps:sync` that keeps its computed band (issue #4158).
    //
    // The condition is "will the sync run?", not "will we merge?" (issue
    // #4159): `--no-merge` never reaches the sync, but the housekeeping mode
    // ALWAYS does — it exists to run exactly that list on a PR that merged
    // elsewhere — so keying this on `merge` alone would hand the recovery path
    // a null band and file its gaps under a different umbrella than the
    // landing path would have.
    const origin: OriginBand =
        mode === "housekeeping" || merge
            ? originBandForBranch(branch)
            : { band: null };
    if (origin.reason !== undefined)
        console.warn(`land: gaps:sync gets no --band (${origin.reason})`);

    const runRoot = gateRunRoot(process.env);
    const housekeeping: HousekeepingOptions = {
        branch,
        pr,
        primaryCheckout: primary,
        worktree: cwd,
        teardown,
        originBand: origin.band,
    };
    const command =
        mode === "housekeeping"
            ? buildHousekeepingCommand(housekeeping)
            : buildLockedCommand({
                  ...housekeeping,
                  gatedGreen: readGreenLaneRuns(runRoot),
                  laneRecordDir: join(runRoot, `land-lane-${pr}`),
                  merge,
              });

    console.log(
        mode === "housekeeping"
            ? `land: PR #${pr} is already MERGED — running the post-merge housekeeping only (no rebase, no lane gate, no merge)`
            : `land: gating PR #${pr} on ${branch} — one heavy lock, ${
                  merge ? "with" : "without"
              } merge`
    );
    // `--no-merge` means "gate and push, never merge", and there is nothing
    // left here to withhold: the merge already happened. Say so rather than
    // running a full housekeeping pass under a flag the caller read as
    // "touch nothing" — the housekeeping WRITES (the ledger, the primary
    // checkout's base branch, the deployment's scenario row, `gh` labels),
    // and a silent write under a flag that reads as restraint is the same
    // class of surprise this issue is about.
    if (mode === "housekeeping" && !merge) {
        console.warn(
            `land: --no-merge has no effect on an already-MERGED PR — the housekeeping below still runs and still writes (landing ledger, local ${BASE_BRANCH}, scenario seed, gaps:sync, claim, teardown). Ctrl-C now if that is not what you wanted.`
        );
    }
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
