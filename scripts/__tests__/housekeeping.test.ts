import { describe, it, expect } from "vitest";
import { ALLOWLIST_COMMIT_SUBJECT } from "../gaps-sync";
import {
    FIRST_RUN_LOOKBACK_MS,
    MAX_ATTEMPTS,
    SWEEP_STEP,
    batchBand,
    gapsSyncStep,
    needsNextPage,
    nextState,
    originBandForBranch,
    parseState,
    pendingPrs,
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
            retry: [{ ...older, attempts: 1, band: null }],
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
        expect(state.retry).toEqual([{ ...older, attempts: 1, band: null }]);
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
        expect(dropped).toEqual([
            { ...older, attempts: MAX_ATTEMPTS, band: null },
        ]);
    });

    it("processes each PR once, oldest merge first, when it is both new and up for retry", () => {
        const state: HousekeepingState = {
            since: "2026-10-11T10:00:00.000Z",
            retry: [{ ...newer, attempts: 2, band: null }],
        };
        expect(pendingPrs([newer, older], state)).toEqual([newer]);
        const mid = pr(5002, "2026-10-11T10:30:00Z");
        expect(
            pendingPrs([newer, mid], { ...state, retry: [] }).map(
                (p) => p.number
            )
        ).toEqual([5002, 5003]);
    });

    it("keeps the band a failed PR first ran with — its detach may have removed the parent edge since (issue #4158)", () => {
        const start: HousekeepingState = {
            since: "2026-10-11T08:00:00.000Z",
            retry: [],
        };
        const { state } = nextState(
            start,
            [older],
            new Set([older.number]),
            new Map([[older.number, "P0" as const]])
        );
        expect(state.retry).toEqual([{ ...older, attempts: 1, band: "P0" }]);
        // A state file written before the field existed reads as bandless.
        expect(
            parseState(
                JSON.stringify({
                    since: start.since,
                    retry: [{ ...older, attempts: 1 }],
                }),
                Date.now()
            ).retry
        ).toEqual([{ ...older, attempts: 1, band: null }]);
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
            pr(5458, "2026-10-11T10:00:00Z", "feat/issue-5457"),
            null
        );
        expect(steps.map((s) => s.holesExit === true)).toEqual([
            true,
            false,
            false,
        ]);
    });

    it("runs gaps:sync once for the batch, P0 when any PR closed P0 work, never --no-file-bot (issues #4158, #5301)", () => {
        expect(batchBand([null, "P2", "P0"])).toBe("P0");
        expect(batchBand(["P1", null])).toBeNull();
        expect(gapsSyncStep(null).argv).toEqual([
            "bun",
            "scripts/gaps-sync.ts",
        ]);
        expect(gapsSyncStep("P0").argv).toEqual([
            "bun",
            "scripts/gaps-sync.ts",
            "--band",
            "P0",
        ]);
        for (const band of [null, "P0"] as const)
            expect(gapsSyncStep(band).argv).not.toContain("--no-file-bot");
    });

    it("per PR: residue, then the claim release, then the umbrella detach — on the issue the branch names (issues #5222, #3130, #4235)", () => {
        const steps = prSteps(
            pr(5458, "2026-10-11T10:00:00Z", "feat/issue-5457"),
            "P0"
        );
        expect(steps.map((s) => s.argv)).toEqual([
            [
                "bun",
                "scripts/grammar-residue.ts",
                "5457",
                "--pr",
                "5458",
                "--band",
                "P0",
            ],
            [
                "gh",
                "issue",
                "edit",
                "5457",
                "--remove-label",
                "in-progress",
                "--remove-assignee",
                "@me",
            ],
            ["bun", "scripts/umbrella-detach.ts", "5457"],
        ]);
        expect(
            prSteps(pr(5458, "2026-10-11T10:00:00Z", "fix/issue-7"), null)[0]!
                .argv
        ).not.toContain("--band");
    });

    it("has no per-PR step for a branch naming no issue; the sweep runs once per batch (issue #5081)", () => {
        expect(
            prSteps(
                pr(5459, "2026-10-11T10:00:00Z", "chore/no-issue-branch"),
                null
            )
        ).toEqual([]);
        expect(SWEEP_STEP.argv).toEqual([
            "bun",
            "scripts/umbrella-detach.ts",
            "--sweep",
        ]);
    });
});

describe("housekeeping.ts — the origin band (issue #4158)", () => {
    it("originBandForBranch: the band of the issue the branch names, by queue:plan's own rule (issue #4158)", () => {
        const board = { 4099: "P0", 4200: "P2", 4300: "P3" } as const;
        const deps = (
            parents: Record<number, number | null>,
            parentState: "OPEN" | "CLOSED" = "OPEN"
        ) => ({
            readParent: (n: number) => {
                const parent = parents[n];
                return parent == null
                    ? null
                    : { number: parent, state: parentState };
            },
            readBoard: () => ({ ...board }),
        });
        // Own priority.
        expect(
            originBandForBranch("feat/issue-4200", deps({ 4200: null })).band
        ).toBe("P2");
        // Inherited from the parent PRD — the grammar-rule shape: the issue
        // carries no Priority of its own, its umbrella is P0.
        expect(
            originBandForBranch("feat/issue-4128", deps({ 4128: 4099 })).band
        ).toBe("P0");
        // The parent governs, in both directions (issue #4371): a P2 child of
        // a P0 umbrella rises, and a P0 child of a P3 umbrella falls. The
        // second case is what keeps `gaps:sync --band` honest — a gap born of
        // work the maintainer filed under a P3 epic is P3 work, whatever the
        // slice was hand-marked at filing time.
        expect(
            originBandForBranch("fix/issue-4200", deps({ 4200: 4099 })).band
        ).toBe("P0");
        expect(
            originBandForBranch("fix/issue-4099", deps({ 4099: 4300 })).band
        ).toBe("P3");
        // A CLOSED umbrella governs nothing (issue #4105): the band degrades
        // to the issue's own value, so a landing under a dead P0 epic does not
        // file its gaps into that epic's band.
        expect(
            originBandForBranch(
                "fix/issue-4200",
                deps({ 4200: 4099 }, "CLOSED")
            ).band
        ).toBe("P2");
    });

    it("originBandForBranch: never throws — a branch naming no issue, an unprioritised issue and an unreadable board are a null band plus a reason (issue #4158)", () => {
        const ok = { readParent: () => null, readBoard: () => ({}) };
        const noIssue = originBandForBranch("main", ok);
        expect(noIssue.band).toBeNull();
        expect(noIssue.reason).toMatch(/names no issue/);
        const unranked = originBandForBranch("feat/issue-1", ok);
        expect(unranked.band).toBeNull();
        expect(unranked.reason).toMatch(/carry no board Priority/);
        const boardDown = originBandForBranch("feat/issue-1", {
            readParent: () => null,
            readBoard: () => {
                throw new Error("rate limited");
            },
        });
        expect(boardDown.band).toBeNull();
        expect(boardDown.reason).toMatch(/board Priority \(rate limited\)/);
        const parentDown = originBandForBranch("feat/issue-1", {
            readParent: () => {
                throw new Error("gh exploded");
            },
            readBoard: () => ({}),
        });
        expect(parentDown.band).toBeNull();
        expect(parentDown.reason).toMatch(/parent of issue #1 \(gh exploded\)/);
    });
});
