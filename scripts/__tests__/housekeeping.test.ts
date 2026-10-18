import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ALLOWLIST_COMMIT_SUBJECT } from "../gaps-sync";
import {
    FIRST_RUN_LOOKBACK_MS,
    GAPS_SYNC_STEP,
    MAX_ATTEMPTS,
    SWEEP_STEP,
    needsNextPage,
    nextState,
    parseState,
    pendingPrs,
    prRetried,
    prSteps,
    strandedAllowlistOnly,
    type HousekeepingState,
    type MergedPr,
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

describe("housekeeping.ts — the steps", () => {
    it("drops a local divergence only when it is gaps:sync's own stranded allowlist commits", () => {
        const sync = {
            subject: ALLOWLIST_COMMIT_SUBJECT,
            files: ["data/grammar-gaps.json"],
        };
        expect(strandedAllowlistOnly([sync])).toBe(true);
        expect(strandedAllowlistOnly([sync, sync])).toBe(true);
        expect(strandedAllowlistOnly([])).toBe(false);
        expect(
            strandedAllowlistOnly([sync, { subject: "wip", files: ["a.ts"] }])
        ).toBe(false);
        expect(
            strandedAllowlistOnly([
                { ...sync, files: ["data/grammar-gaps.json", "a.ts"] },
            ])
        ).toBe(false);
        expect(
            strandedAllowlistOnly([{ ...sync, subject: "gaps:sync — other" }])
        ).toBe(false);
    });

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
        expect(source).toMatch(/const synced = run\(GAPS_SYNC_STEP\);/);
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
