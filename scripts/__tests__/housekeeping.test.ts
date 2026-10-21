import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_BRANCH } from "../lib/branches";
import {
    DERIVE_SYNC_STEP,
    FIRST_RUN_LOOKBACK_MS,
    GAPS_SYNC_STEP,
    PRUNE_REGRESSIONS_STEP,
    plannedSteps,
    GAPS_SYNC_TIMEOUT_MS,
    GIT_STEP_TIMEOUT_MS,
    MAX_ATTEMPTS,
    SWEEP_STEP,
    needsNextPage,
    nextState,
    noticeDue,
    parseState,
    pendingPrs,
    prRetried,
    prSteps,
    prepareWorkspace,
    redSummary,
    removeWorkspace,
    staleWorkspaces,
    withNotice,
    workspacePath,
    type HousekeepingState,
    type MergedPr,
    type RetryEntry,
} from "../housekeeping";

/**
 * `bun run housekeeping` — the GitHub-bound post-merge steps that left `land`
 * for an hourly cron (ADR 0154 §5, issue #5457).
 */

const pr = (number: number, mergedAt: string, branch?: string): MergedPr => ({
    number,
    headRefName: branch ?? `feat/issue-${number - 1}`,
    mergedAt,
});

describe("housekeeping.ts — the watermark", () => {
    const older = pr(5001, "2026-10-11T09:00:00Z");
    const newer = pr(5003, "2026-10-11T11:00:00Z");

    it("given two merged PRs and a watermark between them, processes only the newer", () => {
        const state: HousekeepingState = {
            since: "2026-10-11T10:00:00.000Z",
            retry: [],
        };
        expect(pendingPrs([newer, older], state)).toEqual([newer]);
    });

    it("a second run with nothing new merged is a no-op", () => {
        const first: HousekeepingState = {
            since: "2026-10-11T08:00:00.000Z",
            retry: [],
        };
        const pending = pendingPrs([newer, older], first);
        expect(pending).toEqual([older, newer]);
        const { state } = nextState(first, pending, new Set());
        expect(state).toEqual({ since: newer.mergedAt, retry: [] });
        expect(pendingPrs([newer, older], state)).toEqual([]);
    });

    it("never moves the watermark backwards", () => {
        const state: HousekeepingState = {
            since: "2026-10-11T12:00:00.000Z",
            retry: [{ ...older, attempts: 1 }],
        };
        expect(nextState(state, [older], new Set()).state.since).toBe(
            state.since
        );
    });

    it("retries a failed PR next run — even once it has fallen off the merged list — and gives up after MAX_ATTEMPTS", () => {
        const start: HousekeepingState = {
            since: "2026-10-11T08:00:00.000Z",
            retry: [],
        };
        let { state, dropped } = nextState(
            start,
            [older, newer],
            new Set([older.number])
        );
        expect(state.since).toBe(newer.mergedAt);
        expect(state.retry).toEqual([{ ...older, attempts: 1 }]);
        expect(dropped).toEqual([]);
        // Not in the list any more: the retry entry carries the PR whole.
        expect(pendingPrs([], state)).toEqual([older]);
        // Retried and green: gone.
        expect(nextState(state, [older], new Set()).state.retry).toEqual([]);
        // Red every time: dropped at the bound, loudly (the caller prints).
        for (let i = 1; i < MAX_ATTEMPTS; i++)
            ({ state, dropped } = nextState(
                state,
                pendingPrs([], state),
                new Set([older.number])
            ));
        expect(state.retry).toEqual([]);
        expect(dropped).toEqual([{ ...older, attempts: MAX_ATTEMPTS }]);
    });

    it("processes each PR once, oldest merge first, when it is both new and up for retry", () => {
        const state: HousekeepingState = {
            since: "2026-10-11T10:00:00.000Z",
            retry: [{ ...newer, attempts: 2 }],
        };
        expect(pendingPrs([newer, older], state)).toEqual([newer]);
        const mid = pr(5002, "2026-10-11T10:30:00Z");
        expect(
            pendingPrs([newer, mid], { ...state, retry: [] }).map(
                (p) => p.number
            )
        ).toEqual([5002, 5003]);
    });

    it("a state file written with the retired `band` field reads without it (issue #5871)", () => {
        const start = "2026-10-11T08:00:00.000Z";
        expect(
            parseState(
                JSON.stringify({
                    since: start,
                    retry: [{ ...older, attempts: 1, band: "P0" }],
                }),
                Date.now()
            ).retry
        ).toEqual([{ ...older, attempts: 1 }]);
    });

    it("pages the merged list until a PR last updated before the watermark — a merge updates a PR", () => {
        const since = "2026-10-11T10:00:00.000Z";
        const node = (updatedAt: string) => ({
            ...older,
            updatedAt,
        });
        const page = (updatedAts: string[], hasNextPage = true) => ({
            nodes: updatedAts.map(node),
            hasNextPage,
        });
        // The page's oldest update is still after the watermark: a PR merged
        // after it may be on the next page.
        expect(
            needsNextPage(
                page(["2026-10-11T12:00:00Z", "2026-10-11T10:30:00Z"]),
                since
            )
        ).toBe(true);
        // Reached a PR updated before the watermark: nothing merged after it
        // can come later (updatedAt ≥ mergedAt).
        expect(
            needsNextPage(
                page(["2026-10-11T12:00:00Z", "2026-10-11T09:59:00Z"]),
                since
            )
        ).toBe(false);
        expect(
            needsNextPage(page(["2026-10-11T12:00:00Z"], false), since)
        ).toBe(false);
        expect(needsNextPage(page([]), since)).toBe(false);
    });

    it("a missing or corrupt state file is a first run, a day back", () => {
        const now = Date.parse("2026-10-11T12:00:00Z");
        const fresh = {
            since: new Date(now - FIRST_RUN_LOOKBACK_MS).toISOString(),
            retry: [],
        };
        expect(parseState(null, now)).toEqual(fresh);
        expect(parseState("{not json", now)).toEqual(fresh);
        expect(parseState('{"since":"never"}', now)).toEqual(fresh);
        expect(parseState('{"since":"2026-10-11T10:00:00.000Z"}', now)).toEqual(
            { since: "2026-10-11T10:00:00.000Z", retry: [] }
        );
    });
});

describe("housekeeping.ts — the owner's notice (issue #5873)", () => {
    const entry = (n: number): RetryEntry => ({
        ...pr(n, "2026-10-11T09:00:00Z"),
        attempts: 1,
    });

    it("a green run has no notice; a red one names what is left to retry, what was dropped, or why nothing ran", () => {
        expect(redSummary({ retry: [], dropped: [] })).toBeNull();
        expect(redSummary({ retry: [entry(5001)], dropped: [] })).toBe(
            "housekeeping: 1 PR(s) left to retry: #5001"
        );
        expect(
            redSummary({ retry: [entry(5001)], dropped: [entry(4990)] })
        ).toBe(
            `housekeeping: 1 PR(s) left to retry: #5001; GAVE UP on #4990 after ${MAX_ATTEMPTS} attempts`
        );
        expect(
            redSummary({ retry: [], dropped: [], reason: "could not read x" })
        ).toBe("housekeeping: could not read x");
        // A state write that failed is a red of its own, even with every
        // step green: the watermark did not move.
        expect(
            redSummary({ retry: [], dropped: [], writeFailed: "ref moved" })
        ).toBe("housekeeping: state not written (ref moved)");
    });

    it("sends a notice once per distinct text: the hourly retry of one failure is one message, a green run makes it news again", () => {
        const red = "housekeeping: 1 PR(s) left to retry: #5001";
        const state: HousekeepingState = {
            since: "2026-10-11T08:00:00.000Z",
            retry: [],
        };
        expect(noticeDue(red, undefined)).toBe(true);
        const after = withNotice(state, red);
        expect(after.lastNotice).toBe(red);
        expect(noticeDue(red, after.lastNotice)).toBe(false);
        expect(
            noticeDue(
                "housekeeping: 2 PR(s) left to retry: #5001 #5002",
                after.lastNotice
            )
        ).toBe(true);
        expect(noticeDue(null, after.lastNotice)).toBe(false);
        // A green run clears it; the state carries no stale notice.
        expect(withNotice(after, null)).toEqual(state);
        expect("lastNotice" in withNotice(after, null)).toBe(false);
        // Round-trips through the shared document; a document without it
        // reads as none.
        expect(parseState(JSON.stringify(after), 0).lastNotice).toBe(red);
        expect("lastNotice" in parseState(JSON.stringify(state), 0)).toBe(
            false
        );
    });
});

describe("housekeeping.ts — the workspace (issue #5873)", () => {
    let dir: string;
    const git = (args: string[], cwd: string) =>
        spawnSync("git", args, { cwd, encoding: "utf8" });

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "housekeeping-ws-"));
        git(["init", "-q", "--bare", "-b", BASE_BRANCH, "origin.git"], dir);
        git(["clone", "-q", "origin.git", "primary"], dir);
        const primary = join(dir, "primary");
        git(["config", "user.email", "t@t"], primary);
        git(["config", "user.name", "t"], primary);
        git(["checkout", "-q", "-B", BASE_BRANCH], primary);
        writeFileSync(join(primary, "a"), "a");
        git(["add", "."], primary);
        git(["commit", "-qm", "a"], primary);
        git(["push", "-q", "origin", BASE_BRANCH], primary);
    });
    afterEach(() =>
        rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        })
    );

    it("names the workspace beside the primary and tells its leftovers from issue worktrees", () => {
        expect(workspacePath("/x/tolaria", 42)).toBe(
            "/x/tolaria-housekeeping-42"
        );
        const porcelain = [
            "worktree /x/tolaria",
            "HEAD aaa",
            "",
            "worktree /x/tolaria-issue-5873",
            "HEAD bbb",
            "",
            "worktree /x/tolaria-housekeeping-99",
            "HEAD ccc",
            "",
            "worktree /x/tolaria-housekeeping-abc",
            "",
        ].join("\n");
        expect(staleWorkspaces(porcelain, "/x/tolaria")).toEqual([
            "/x/tolaria-housekeeping-99",
        ]);
    });

    it("a diverged, dirty primary on another branch still yields a clean worktree at the base tip — and is left exactly as it was", () => {
        const primary = join(dir, "primary");
        // The base moves on origin…
        const other = join(dir, "other");
        git(["clone", "-q", "origin.git", "other"], dir);
        git(["config", "user.email", "t@t"], other);
        git(["config", "user.name", "t"], other);
        writeFileSync(join(other, "b"), "b");
        git(["add", "."], other);
        git(["commit", "-qm", "b"], other);
        git(["push", "-q", "origin", `HEAD:${BASE_BRANCH}`], other);
        const tip = git(["rev-parse", "HEAD"], other).stdout.trim();
        // …while the primary sits on a WIP branch with a local commit and dirt.
        git(["checkout", "-q", "-b", "wip"], primary);
        writeFileSync(join(primary, "local"), "local");
        git(["add", "."], primary);
        git(["commit", "-qm", "local"], primary);
        writeFileSync(join(primary, "dirty"), "dirty");
        const head = git(["rev-parse", "HEAD"], primary).stdout.trim();
        // A killed run's leftover, registered.
        const stale = workspacePath(primary, 1);
        git(["worktree", "add", "--detach", "-q", stale, "HEAD"], primary);

        const wt = prepareWorkspace(primary, { pid: 2, bootstrap: false });
        expect(wt).toBe(workspacePath(realpathSync(primary), 2));
        expect(git(["rev-parse", "HEAD"], wt).stdout.trim()).toBe(tip);
        expect(git(["status", "--porcelain"], wt).stdout).toBe("");
        expect(existsSync(stale)).toBe(false);
        // The primary: same branch, same head, same dirt.
        expect(
            git(["symbolic-ref", "--short", "HEAD"], primary).stdout.trim()
        ).toBe("wip");
        expect(git(["rev-parse", "HEAD"], primary).stdout.trim()).toBe(head);
        expect(existsSync(join(primary, "dirty"))).toBe(true);

        expect(removeWorkspace(primary, wt)).toBe(true);
        expect(existsSync(wt)).toBe(false);
        expect(
            staleWorkspaces(
                git(["worktree", "list", "--porcelain"], primary).stdout,
                realpathSync(primary)
            )
        ).toEqual([]);
    });
});

describe("housekeeping.ts — the steps", () => {
    it("reads grammar:residue's holes exit as a finding, not a failure — every other step's non-zero is one", () => {
        const steps = prSteps(
            pr(5458, "2026-10-11T10:00:00Z", "feat/issue-5457")
        );
        expect(steps.map((s) => s.holesExit === true)).toEqual([
            true,
            false,
            false,
        ]);
    });

    it("runs gaps:sync once for the batch — never --no-file-bot, never --band — and a failed one (a lost allowlist write-back included) keeps every PR of the batch in retry, whatever its own steps did (issues #5301, #5871)", () => {
        expect(prRetried(false, true)).toBe(true);
        expect(prRetried(false, false)).toBe(true);
        expect(prRetried(true, false)).toBe(true);
        expect(prRetried(true, true)).toBe(false);
        // `main` reads it from the ONE gaps:sync run, per PR — pinned by
        // SHAPE: `main` spawns processes.
        const source = readFileSync("scripts/housekeeping.ts", "utf8");
        expect(GAPS_SYNC_STEP.argv).toEqual(["bun", "scripts/gaps-sync.ts"]);
        expect(source.match(/run\(GAPS_SYNC_STEP\)/g)).toHaveLength(1);
        expect(source).toMatch(
            /const synced = pending\.length === 0 \|\| run\(GAPS_SYNC_STEP\);/
        );
        expect(source).toMatch(/const retry = prRetried\(synced, own\);/);
        expect(source).toMatch(/if \(retry\) failed\.add\(pr\.number\);/);
    });

    it("per PR: residue, then the claim release, then the umbrella detach — on the issue the branch names, no band (issues #5222, #3130, #4235, #5871)", () => {
        const steps = prSteps(
            pr(5458, "2026-10-11T10:00:00Z", "feat/issue-5457")
        );
        expect(steps.map((s) => s.argv)).toEqual([
            ["bun", "scripts/grammar-residue.ts", "5457", "--pr", "5458"],
            [
                "gh",
                "issue",
                "edit",
                "5457",
                "--remove-label",
                "in-progress",
                "--remove-label",
                "pr-open",
                "--remove-assignee",
                "@me",
            ],
            ["bun", "scripts/umbrella-detach.ts", "5457"],
        ]);
        // No step of the cron derives or forwards a band (issue #5871).
        const source = readFileSync("scripts/housekeeping.ts", "utf8");
        expect(source).not.toMatch(/"--band"/);
        expect(source).not.toMatch(/origin-band/);
    });

    it("has no per-PR step for a branch naming no issue; the sweep runs once per batch (issue #5081)", () => {
        expect(
            prSteps(pr(5459, "2026-10-11T10:00:00Z", "chore/no-issue-branch"))
        ).toEqual([]);
        expect(SWEEP_STEP.argv).toEqual([
            "bun",
            "scripts/umbrella-detach.ts",
            "--sweep",
        ]);
    });
});

describe("housekeeping's steps have deadlines inside the job's (issue #5933)", () => {
    const source = readFileSync("scripts/housekeeping.ts", "utf8");
    const workflow = readFileSync(".github/workflows/post-merge.yml", "utf8");

    it("gaps:sync is killed by housekeeping itself, well before the job's timeout-minutes — the batch is retried, never cut mid-run by the runner", () => {
        const job = workflow.slice(workflow.indexOf("\n    housekeeping:"));
        const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(job)?.[1]);
        expect(minutes).toBeGreaterThan(0);
        expect(GAPS_SYNC_STEP.timeoutMs).toBe(GAPS_SYNC_TIMEOUT_MS);
        // Room left for the batch-band reads before it and the per-PR steps after.
        expect(GAPS_SYNC_TIMEOUT_MS).toBeLessThanOrEqual(
            (minutes - 15) * 60_000
        );
    });

    it("the step runner enforces a step's deadline, and the workspace's base-branch fetch has one", () => {
        expect(source).toMatch(/timeout: step\.timeoutMs,/);
        expect(source).toMatch(
            /"fetch",[^\]]*"origin",\s*BASE_BRANCH,\s*\],\s*GIT_STEP_TIMEOUT_MS\s*\)/
        );
        expect(GIT_STEP_TIMEOUT_MS).toBeGreaterThan(0);
    });
});

describe("housekeeping.ts — derive:sync runs every run (ADR 0157 § Option 1b, issue #6247)", () => {
    it("with nothing merged the run is derive:sync alone — the hourly backstop for a push the base outran", () => {
        expect(plannedSteps([])).toEqual([DERIVE_SYNC_STEP]);
    });

    it("with a batch it follows the two pushes it must build on and precedes the per-PR steps", () => {
        const labels = plannedSteps([
            pr(5458, "2026-10-11T10:00:00Z", "feat/issue-5457"),
        ]).map((s) => s.label);
        expect(labels.slice(0, 3)).toEqual([
            GAPS_SYNC_STEP.label,
            PRUNE_REGRESSIONS_STEP.label,
            DERIVE_SYNC_STEP.label,
        ]);
        expect(labels.at(-1)).toBe(SWEEP_STEP.label);
        expect(labels.filter((l) => l === DERIVE_SYNC_STEP.label)).toHaveLength(
            1
        );
    });

    it("its failure is the run's red, named in the owner's notice, never a PR's retry", () => {
        expect(redSummary({ retry: [], dropped: [], deriveFailed: true })).toBe(
            "housekeeping: derive:sync failed — the base's lockfile header or data/catalogue may be stale until the next run"
        );
        expect(
            redSummary({ retry: [], dropped: [], deriveFailed: false })
        ).toBeNull();
    });
});
