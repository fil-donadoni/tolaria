import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRun } from "../lib/afk-dispatch";
import {
    classifyClaim,
    buildClaimFacts,
    DEFAULT_MIN_AGE_HOURS,
    UNPROVEN_CLAIM_HOURS,
    CLAIM_VERDICT_STATES,
    countUnpushedCommits,
    classifyClaims,
    worktreeQuietMinutes,
    fetchOpenPrs,
    openPrFor,
    type ClaimFacts,
    type ClaimedIssue,
    localWorkSince,
    parseClaimTimes,
    porcelainPath,
    type ShRunner,
} from "../lib/claim-verdict";

/**
 * `afk-dispatch` releases claims on this verdict. The sessions share one GitHub account, so a
 * wrong release unclaims somebody's live work with no signal that it happened —
 * every "live" and "suspect" path is asserted individually, not just the happy
 * orphan case.
 */

const base: ClaimFacts = {
    issue: 2445,
    title: "x",
    hasRemoteBranch: false,
    hasLocalBranch: false,
    hasOpenPr: false,
    ageHours: 48,
    unpushedCommits: null,
};

describe("claim-verdict — classifyClaim", () => {
    it("calls an old claim with no branch and no PR an orphan", () => {
        const v = classifyClaim(base);
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/no run, no pushed work/);
    });

    it("never releases a claim with an open PR", () => {
        expect(classifyClaim({ ...base, hasOpenPr: true }).state).toBe("live");
    });

    it("never releases a claim whose branch was PUSHED", () => {
        expect(classifyClaim({ ...base, hasRemoteBranch: true }).state).toBe(
            "live"
        );
    });

    it("holds a local-only branch live while it could still be implementing", () => {
        // A pass that got as far as `git worktree add` may legitimately
        // implement for hours before its first push. Two hours is the
        // no-branch threshold and would unclaim it.
        const v = classifyClaim({
            ...base,
            hasLocalBranch: true,
            ageHours: 6,
        });
        expect(v.state).toBe("live");
        expect(v.reason).toMatch(/could still be implementing/);
    });

    it("calls a local-only branch nobody pushed in a day an orphan", () => {
        // The shape that stranded eight claims for 25-36 hours: the pass was
        // killed mid-edit, and its local branch outlives it forever, so a
        // branch check that does not ask WHERE the branch is reads dead work
        // as live for as long as anyone cares to look.
        const v = classifyClaim({
            ...base,
            hasLocalBranch: true,
            ageHours: 30,
        });
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/never pushed/);
    });

    it("takes the local-only threshold as a parameter too", () => {
        const facts = { ...base, hasLocalBranch: true, ageHours: 10 };
        expect(classifyClaim(facts, 2, 8).state).toBe("orphan");
        expect(classifyClaim(facts, 2, 12).state).toBe("live");
    });

    it("a PUSHED branch is never re-read as local-only", () => {
        // buildClaimFacts sets hasLocalBranch only when the remote does NOT
        // have it; this pins the classifier's half of that contract.
        expect(
            classifyClaim({
                ...base,
                hasRemoteBranch: true,
                ageHours: 500,
            }).state
        ).toBe("live");
    });

    it("holds a FRESH claim as suspect — that is what a healthy pass looks like before its first push", () => {
        // The window between "batch claimed" and "branch pushed" is minutes
        // long and has no branch and no PR: identical to an orphan on every
        // observable. Releasing it would unclaim a running batch.
        const v = classifyClaim({ ...base, ageHours: 0.5 });
        expect(v.state).toBe("suspect");
        expect(v.reason).toMatch(/healthy pass/);
    });

    it("takes both thresholds as parameters, and each boundary is inclusive-above", () => {
        // Past `minAgeHours` an unproven claim is still `suspect` — absence
        // is not death (issue #6223) — and only the reason changes; past
        // `unprovenHours` it is an orphan.
        expect(classifyClaim({ ...base, ageHours: 1.99 }).reason).toMatch(
            /healthy pass/
        );
        expect(classifyClaim({ ...base, ageHours: 2 }).reason).toMatch(
            /absence is not death/
        );
        expect(classifyClaim({ ...base, ageHours: 5 }, 6).reason).toMatch(
            /healthy pass/
        );
        expect(classifyClaim({ ...base, ageHours: 24 }).state).toBe("orphan");
        expect(classifyClaim({ ...base, ageHours: 23.99 }).state).toBe(
            "suspect"
        );
        expect(classifyClaim({ ...base, ageHours: 10 }, 2, 8).state).toBe(
            "orphan"
        );
    });

    it("defaults the age threshold to the EXPORTED constant, not a re-declared literal (#2632)", () => {
        // `DEFAULT_MIN_AGE_HOURS` is exported so the dashboard's claims-table
        // amber band (`dashboard/lib/nowClaims.ts`'s
        // `MIN_AGE_HOURS`) reuses the same number instead of a second `2`.
        // This pins that the DEFAULT parameter is actually driven by the
        // constant, not merely a coincidentally-equal literal beside it.
        expect(DEFAULT_MIN_AGE_HOURS).toBe(2);
        expect(
            classifyClaim({ ...base, ageHours: DEFAULT_MIN_AGE_HOURS }).reason
        ).toMatch(/absence is not death/);
        expect(
            classifyClaim({ ...base, ageHours: DEFAULT_MIN_AGE_HOURS - 0.01 })
                .reason
        ).toMatch(/healthy pass/);
        expect(UNPROVEN_CLAIM_HOURS).toBe(24);
        expect(
            classifyClaim({ ...base, ageHours: UNPROVEN_CLAIM_HOURS }).state
        ).toBe("orphan");
        expect(
            classifyClaim({ ...base, ageHours: UNPROVEN_CLAIM_HOURS - 0.01 })
                .state
        ).toBe("suspect");
    });

    it("lets a PR override even a very fresh claim", () => {
        expect(
            classifyClaim({ ...base, ageHours: 0.1, hasOpenPr: true }).state
        ).toBe("live");
    });
});

/**
 * `buildClaimFacts` (#2519) is the extraction the claim readers share.
 * Testing it here pins the exact matching rules (branch-suffix boundary,
 * `refs/heads/` stripping, PR-branch-set lookup) so no reader drifts from
 * what the verdict assumes.
 */
describe("claim-verdict — recoverable: a dead pass that left commits (#3698)", () => {
    const dead = {
        ...base,
        hasLocalBranch: true,
        run: "ended" as ClaimFacts["run"],
        ageHours: 0.5,
    };

    it("is its own verdict state, distinct from live and from orphan", () => {
        // The state exists because the two readings it sits between both lose
        // the work: `live` hides a dead pass's commits behind the 24-hour
        // local-branch rope, and `orphan` drops the label while the commits
        // stay in a worktree nothing points at any more.
        expect(CLAIM_VERDICT_STATES).toContain("recoverable");
        const v = classifyClaim({ ...dead, unpushedCommits: 3 });
        expect(v.state).toBe("recoverable");
        expect(v.reason).toMatch(/3 unpushed commits/);
        expect(v.reason).toMatch(/NOT released/);
    });

    it("fires however YOUNG the claim is — the rope exists for passes that might still be alive", () => {
        // 0.5h in `dead` above is inside every age threshold the classifier
        // has. That is the point: the age rules are a proxy for "is anyone
        // still working on this", and a positive death reading answers the
        // question the proxy was standing in for.
        expect(classifyClaim({ ...dead, unpushedCommits: 1 }).state).toBe(
            "recoverable"
        );
        expect(classifyClaim({ ...dead, unpushedCommits: 1 }).reason).toMatch(
            /1 unpushed commit\b/
        );
    });

    it("needs a POSITIVE death reading — no run of its own changes no verdict", () => {
        // This subsystem's failure mode is declaring a healthy concurrent
        // pass dead, so a claim with no run (an attended session's) keeps the
        // age-rule verdicts.
        const unknown = classifyClaim({
            ...dead,
            run: "none",
            unpushedCommits: 3,
        });
        expect(unknown.state).toBe("live");
        expect(unknown.reason).toMatch(/could still be implementing/);
    });

    it("also fires for a branch with nothing COMMITTED on it — the worktree may hold uncommitted WIP (issue #5174)", () => {
        // Before issue #5174 an empty branch fell through to the 24-hour
        // local-branch rope and read `live`: P0 issue #4862's pass died two
        // minutes in with its edits uncommitted, and the claim read "could
        // still be implementing" for six hours while the loop picked P1 work.
        for (const ageHours of [0.1, 6, 30]) {
            for (const unpushedCommits of [0, null]) {
                const v = classifyClaim({ ...dead, ageHours, unpushedCommits });
                expect(v.state).toBe("recoverable");
                expect(v.reason).toMatch(/no commit/);
                expect(v.reason).toMatch(/NOT released/);
            }
        }
    });

    it("a PUSHED branch is never `recoverable` — its commits are not unpushed at all (a dead pass makes it `stranded`, issue #4763)", () => {
        expect(
            classifyClaim({
                ...dead,
                hasLocalBranch: false,
                hasRemoteBranch: true,
                unpushedCommits: 5,
            }).state
        ).toBe("stranded");
    });
});

describe("claim-verdict — stranded: a dead pass that left PUSHED work (issue #4763)", () => {
    // Observed 2026-09-27: two passes opened their PRs, ended their turns
    // "waiting" on a background job and died with them (`claude -p`). Both
    // claims read `live` on `open PR` alone, and the cap refused the next
    // pick at 3/3 with one session running.
    const pushed = (extra: Partial<ClaimFacts>): ClaimFacts => ({
        ...base,
        ...extra,
    });

    for (const [what, facts] of [
        ["an open PR", { hasOpenPr: true }],
        ["a pushed branch", { hasRemoteBranch: true }],
    ] as const) {
        it(`${what} + a PROVABLY dead pass is \`stranded\` — not live, not orphan, not recoverable`, () => {
            const v = classifyClaim(pushed({ ...facts, run: "ended" }));
            expect(v.state).toBe("stranded");
            expect(v.reason).toMatch(/label is NOT released/);
        });

        it(`${what} with no, an unknown or an active run stays \`live\``, () => {
            // Only a positive death reading moves it.
            for (const run of [
                undefined,
                "none",
                "unknown",
                "active",
            ] as const) {
                expect(classifyClaim(pushed({ ...facts, run })).state).toBe(
                    "live"
                );
            }
        });
    }

    it("classifyClaims names the stranded claim's PR number", () => {
        const issues: ClaimedIssue[] = [
            { number: 4506, title: "a", updatedAt: new Date(0).toISOString() },
            { number: 4470, title: "b", updatedAt: new Date(0).toISOString() },
        ];
        const prs = new Map<string, number | null>([["fix/issue-4506", 4760]]);
        const rows = classifyClaims(issues, {
            prBranches: new Set(prs.keys()),
            prs,
            branches: { local: [], remote: ["feat/issue-4470"] },
            baseRef: "origin/staging",
            now: 0,
            countRunner: () => "0",
        });
        expect(rows.map((r) => [r.issue, r.pr])).toEqual([
            [4506, 4760],
            [4470, null],
        ]);
    });

    it("fetchOpenPrs reads head → number, and openPrFor uses the issue-N suffix rule", () => {
        const prs = fetchOpenPrs(() =>
            JSON.stringify([
                { headRefName: "fix/issue-4506", number: 4760 },
                { headRefName: "feat/issue-45060", number: 1 },
                { headRefName: "feat/issue-4470" },
            ])
        );
        expect(openPrFor(4506, prs)).toBe(4760);
        expect(openPrFor(4470, prs)).toBeNull();
        expect(openPrFor(999, prs)).toBeNull();
    });
});

describe("claim-verdict — countUnpushedCommits (#3698)", () => {
    const runner = (out: string) => () => out;

    it("counts the commits the claim's local branch carries beyond the base", () => {
        expect(
            countUnpushedCommits(
                3698,
                ["main", "fix/issue-3698"],
                "origin/staging",
                runner("2\n")
            )
        ).toBe(2);
    });

    it("returns null — 'unknown', which changes no verdict — on every failure shape", () => {
        // A repo where this cannot be read must behave exactly as it did
        // before the state existed, which is what `null` buys.
        expect(
            countUnpushedCommits(3698, ["main"], "origin/staging", runner("2"))
        ).toBe(null);
        expect(
            countUnpushedCommits(
                3698,
                ["fix/issue-3698"],
                "origin/staging",
                runner("not a number")
            )
        ).toBe(null);
        expect(
            countUnpushedCommits(
                3698,
                ["fix/issue-3698"],
                "origin/staging",
                () => {
                    throw new Error("fatal: bad revision");
                }
            )
        ).toBe(null);
    });

    it("matches the branch by its issue SUFFIX, never by a prefix of the number", () => {
        // `issue-369` must not answer for `issue-3698`, and the `feat/`
        // vs `fix/` prefix must not matter — the same suffix rule
        // `buildClaimFacts` already uses to decide a branch belongs to a claim.
        expect(
            countUnpushedCommits(
                369,
                ["fix/issue-3698"],
                "origin/staging",
                runner("4")
            )
        ).toBe(null);
        expect(
            countUnpushedCommits(
                3698,
                ["feat/issue-3698"],
                "origin/staging",
                runner("4")
            )
        ).toBe(4);
    });
});

describe("claim-verdict — buildClaimFacts", () => {
    const issue: ClaimedIssue = {
        number: 2519,
        title: "claim status",
        updatedAt: "2026-08-17T00:00:00Z",
    };

    it("matches a local branch by its issue-N suffix, ignoring an unrelated issue number", () => {
        const facts = buildClaimFacts(
            issue,
            new Set(),
            { local: ["feat/issue-2519", "feat/issue-25190"], remote: [] },
            new Date("2026-08-18T00:00:00Z").getTime()
        );
        expect(facts.hasLocalBranch).toBe(true);
        expect(facts.hasRemoteBranch).toBe(false);
    });

    it("does NOT match a branch whose suffix merely CONTAINS the issue number", () => {
        // "issue-25190" must not satisfy "issue-2519" — a prefix match here
        // would silently mark #2519 live because of an unrelated issue.
        const facts = buildClaimFacts(
            issue,
            new Set(),
            { local: ["feat/issue-25190"], remote: ["feat/issue-25190"] },
            Date.now()
        );
        expect(facts.hasLocalBranch).toBe(false);
        expect(facts.hasRemoteBranch).toBe(false);
    });

    it("strips the refs/heads/ prefix a remote scan can carry", () => {
        const facts = buildClaimFacts(
            issue,
            new Set(),
            { local: [], remote: ["refs/heads/fix/issue-2519"] },
            Date.now()
        );
        expect(facts.hasRemoteBranch).toBe(true);
    });

    it("matches an open PR by its head branch's issue-N suffix", () => {
        const facts = buildClaimFacts(
            issue,
            new Set(["feat/issue-2519"]),
            { local: [], remote: [] },
            Date.now()
        );
        expect(facts.hasOpenPr).toBe(true);
    });

    it("a branch present on BOTH sides is remote, never local-only", () => {
        // The whole split turns on this: a pushed branch appears in the local
        // list too, and reporting it as local-only would give every healthy
        // claim the dead shape.
        const facts = buildClaimFacts(
            issue,
            new Set(),
            {
                local: ["feat/issue-2519"],
                remote: ["feat/issue-2519"],
            },
            Date.now()
        );
        expect(facts.hasRemoteBranch).toBe(true);
        expect(facts.hasLocalBranch).toBe(false);
    });

    it("computes ageHours from now minus updatedAt", () => {
        const now = new Date("2026-08-18T06:00:00Z").getTime();
        const facts = buildClaimFacts(
            issue,
            new Set(),
            { local: [], remote: [] },
            now
        );
        expect(facts.ageHours).toBeCloseTo(30, 5);
    });
});

/**
 * A dead pass — its `afk-pass` run ended — is reaped by evidence, not after
 * 24h. Anything short of that positive reading keeps the age rules: the
 * failure mode of this sweep is unclaiming a healthy concurrent pass.
 */
describe("claim-verdict — a provably dead pass (#2627)", () => {
    it("AC1 — no branch, no PR and a provably dead pass is an orphan", () => {
        const v = classifyClaim({ ...base, run: "ended" });
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/no branch, no PR/);
    });

    it("AC2 — a PUSHED branch is never released whatever its age; a dead pass makes it `stranded`, not `orphan` (issue #4763)", () => {
        // Age and a dead pass together must still not RELEASE pushed work.
        // Since issue #4763 they no longer read `live` either: `stranded`
        // keeps the label and hands the work to the next pass.
        expect(
            classifyClaim({
                ...base,
                hasRemoteBranch: true,
                ageHours: 500,
                run: "ended",
            }).state
        ).toBe("stranded");
        expect(
            classifyClaim({ ...base, hasOpenPr: true, run: "ended" }).state
        ).toBe("stranded");
    });

    it("AC3 — a PROVABLY dead pass skips the age rule: no branch is an orphan at once (issue #5174)", () => {
        // The age rule stands in for "is anyone still working on this" when
        // we cannot see the pass; an ended run answers the question directly.
        const v = classifyClaim({ ...base, ageHours: 0.5, run: "ended" });
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/run ended/);
    });

    it("a dead pass's claim minutes old is still `suspect` — the run list may lag the claim (issue #5174)", () => {
        for (const minutes of [0, 1, 4.9]) {
            expect(
                classifyClaim({
                    ...base,
                    ageHours: minutes / 60,
                    run: "ended",
                }).state
            ).toBe("suspect");
        }
        expect(
            classifyClaim({ ...base, ageHours: 5 / 60, run: "ended" }).state
        ).toBe("orphan");
    });

    it("a dead pass whose worktree changed recently is `live` — a session may have resumed it by hand (issue #5174)", () => {
        const dead: ClaimFacts = {
            ...base,
            hasLocalBranch: true,
            run: "ended",
            unpushedCommits: 0,
        };
        const busy = classifyClaim({ ...dead, worktreeQuietMinutes: 3 });
        expect(busy.state).toBe("live");
        expect(busy.reason).toMatch(/resumed session/);
        expect(
            classifyClaim({ ...dead, worktreeQuietMinutes: 29.9 }).state
        ).toBe("live");
        expect(classifyClaim({ ...dead, worktreeQuietMinutes: 30 }).state).toBe(
            "recoverable"
        );
        expect(
            classifyClaim({ ...dead, worktreeQuietMinutes: null }).state
        ).toBe("recoverable");
    });

    it("AC6 — a claim with no run keeps the age-rule verdicts", () => {
        // Reading it as "dead" would quietly widen what the sweep releases;
        // reading it as "alive" would freeze the queue. It must do neither:
        // the 2h / 24h age rules decide.
        for (const [facts, state] of [
            [base, "orphan"],
            [{ ...base, ageHours: 0.5 }, "suspect"],
            [{ ...base, hasLocalBranch: true, ageHours: 30 }, "orphan"],
            [{ ...base, hasLocalBranch: true, ageHours: 6 }, "live"],
        ] as const) {
            expect(classifyClaim({ ...facts, run: "none" }).state).toBe(state);
        }
    });

    it("the age thresholds bind a claim with no run only — a dead pass has none (issue #5174)", () => {
        for (const ageHours of [0, 1.99, 2, 5, 23.9, 24, 100]) {
            expect(
                classifyClaim({ ...base, ageHours, run: "none" }).state
            ).toBe(ageHours < 24 ? "suspect" : "orphan");
            expect(
                classifyClaim({
                    ...base,
                    hasLocalBranch: true,
                    ageHours,
                    run: "none",
                }).state
            ).toBe(ageHours < 24 ? "live" : "orphan");
            expect(
                classifyClaim({ ...base, ageHours, run: "ended" }).state
            ).toBe(ageHours === 0 ? "suspect" : "orphan");
            expect(
                classifyClaim({
                    ...base,
                    hasLocalBranch: true,
                    ageHours,
                    run: "ended",
                }).state
            ).toBe("recoverable");
        }
    });
});

describe("worktreeQuietMinutes — the resumed-session veto's input (issue #5174)", () => {
    const now = 1_000_000_000;
    const list = [
        "worktree /repo",
        "HEAD abc",
        "branch refs/heads/staging",
        "",
        "worktree /repo-issue-42",
        "HEAD def",
        "branch refs/heads/fix/issue-42",
        "",
    ].join("\n");
    const runner = (_cmd: string, args: string[]): string => {
        if (args[0] === "worktree") return list;
        if (args.includes("rev-parse")) return "/repo/.git/worktrees/x/index\n";
        if (args.includes("status"))
            return " M scripts/a.ts\nR  old.ts -> new.ts\n?? b.txt\n";
        throw new Error(`unexpected ${args.join(" ")}`);
    };

    it("is the age of the NEWEST of index and status paths, found by branch", () => {
        const mtimes: Record<string, number> = {
            "/repo/.git/worktrees/x/index": now - 50 * 60000,
            "/repo-issue-42/scripts/a.ts": now - 40 * 60000,
            "/repo-issue-42/new.ts": now - 7 * 60000,
            "/repo-issue-42/b.txt": now - 90 * 60000,
        };
        expect(
            worktreeQuietMinutes(42, now, runner, (p) => mtimes[p] ?? null)
        ).toBeCloseTo(7, 5);
    });

    it("is null when no worktree holds the branch, or git fails", () => {
        expect(worktreeQuietMinutes(43, now, runner, () => now)).toBeNull();
        expect(
            worktreeQuietMinutes(42, now, () => {
                throw new Error("git down");
            })
        ).toBeNull();
    });
});

describe("claim-verdict — a PR handed to the land-runner (issue #5469)", () => {
    const handedOff: ClaimFacts = {
        ...base,
        hasOpenPr: true,
        hasRemoteBranch: true,
        landQueue: "ready",
    };

    it("`ready-to-land` is pr-open whatever the run — dead by design, never stranded, never orphan", () => {
        for (const run of ["ended", "none", "active"] as const) {
            const v = classifyClaim({
                ...handedOff,
                run,
                ageHours: 500,
            });
            expect(v.state, `run=${run}`).toBe("pr-open");
            expect(v.reason).toMatch(/land-runner/);
        }
    });

    it("`land-failed` is a repair pick (stranded) unless a pass is at work on it", () => {
        const failed = { ...handedOff, landQueue: "failed" as const };
        expect(classifyClaim({ ...failed, run: "none" }).state).toBe(
            "stranded"
        );
        expect(classifyClaim({ ...failed, run: "ended" }).state).toBe(
            "stranded"
        );
        expect(classifyClaim({ ...failed, run: "active" }).state).toBe("live");
    });

    it("no land label keeps the pre-runner verdicts", () => {
        expect(classifyClaim({ ...handedOff, landQueue: null }).state).toBe(
            "live"
        );
    });
});

/**
 * ONE verdict for a claim (issue #6223). The doctor and the dispatcher judged
 * the same claim by different evidence and disagreed; every shape the issue
 * names goes through `classifyClaims` — the pipeline both now call — with
 * the union of their evidence: claim time, `afk-pass` runs,
 * local and pushed branches, open PRs and their queue state.
 */
describe("one claim verdict over the union of the evidence (issue #6223)", () => {
    const NOW = Date.parse("2026-10-21T12:00:00Z");
    const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
    const CLAIMED = ago(8);
    const run = (
        title: string,
        over: Partial<WorkflowRun> = {}
    ): WorkflowRun => ({
        id: 1,
        title,
        status: "completed",
        conclusion: "failure",
        createdAt: ago(7.9),
        updatedAt: ago(7.8),
        ...over,
    });

    type Shape = {
        runs?: WorkflowRun[] | null;
        remote?: string[];
        local?: string[];
        pr?: { branch: string; queue?: "ready" | "failed" };
        claimedAt?: string | null;
        localWork?: boolean | null;
    };
    function verdict(shape: Shape) {
        const prs = new Map<string, number | null>(
            shape.pr ? [[shape.pr.branch, 70]] : []
        );
        const [c] = classifyClaims(
            [
                {
                    number: 7,
                    title: "x",
                    updatedAt: ago(0.1),
                    claimedAt:
                        shape.claimedAt === undefined
                            ? CLAIMED
                            : shape.claimedAt,
                },
            ],
            {
                prBranches: new Set(prs.keys()),
                prs,
                landQueue: new Map(
                    shape.pr?.queue ? [[shape.pr.branch, shape.pr.queue]] : []
                ),
                branches: {
                    local: shape.local ?? [],
                    remote: shape.remote ?? [],
                },
                baseRef: "origin/staging",
                now: NOW,
                countRunner: () => "0",
                worktreeQuiet: () => null,
                localWork: () => shape.localWork ?? null,
                passRuns: shape.runs === undefined ? [] : shape.runs,
            }
        );
        return c.verdict.state;
    }
    const dead = [run("afk-pass #7")];

    it.each<[string, Shape, string]>([
        [
            "a run-matched dead pass with no push → orphan (release)",
            { runs: dead },
            "orphan",
        ],
        [
            "a run-matched dead pass with a pushed branch → stranded (resume)",
            { runs: dead, remote: ["refs/heads/fix/issue-7"] },
            "stranded",
        ],
        [
            "a run-matched dead pass with a `land-failed` PR → stranded (resume)",
            {
                runs: dead,
                remote: ["refs/heads/fix/issue-7"],
                pr: { branch: "fix/issue-7", queue: "failed" },
            },
            "stranded",
        ],
        [
            "a run-matched dead pass with an unlabelled open PR → stranded (resume)",
            {
                runs: dead,
                remote: ["refs/heads/fix/issue-7"],
                pr: { branch: "fix/issue-7" },
            },
            "stranded",
        ],
        [
            "a run-matched dead pass, a stale local branch → orphan, not `could still be implementing`",
            { runs: dead, local: ["fix/issue-7"], localWork: false },
            "orphan",
        ],
        [
            "a run-matched dead pass, local work newer than the claim → recoverable",
            { runs: dead, local: ["fix/issue-7"], localWork: true },
            "recoverable",
        ],
        [
            "an active run → live",
            {
                runs: [
                    run("afk-pass #7", {
                        status: "in_progress",
                        conclusion: null,
                    }),
                ],
            },
            "live",
        ],
        [
            "a claim younger than the cutoff, nothing else → suspect",
            { claimedAt: ago(0.5) },
            "suspect",
        ],
        ["no run, no work → suspect: absence is not death", {}, "suspect"],
        [
            "an older run of the issue proves nothing about a newer claim",
            { runs: [run("afk-pass #7", { createdAt: ago(30) })] },
            "suspect",
        ],
        [
            "unreadable runs → suspect: unknown evidence never releases",
            { runs: null, claimedAt: ago(48) },
            "suspect",
        ],
        [
            "unknown claim time, a completed run → suspect: the run cannot be attributed",
            { runs: dead, claimedAt: null },
            "suspect",
        ],
        [
            "queued for the land-runner → pr-open",
            {
                runs: dead,
                remote: ["refs/heads/fix/issue-7"],
                pr: { branch: "fix/issue-7", queue: "ready" },
            },
            "pr-open",
        ],
    ])("%s", (_name, shape, state) => {
        expect(verdict(shape)).toBe(state);
    });

    it("a claim with no proof either way is released only past a day", () => {
        expect(verdict({ claimedAt: ago(23.9) })).toBe("suspect");
        expect(verdict({ claimedAt: ago(24) })).toBe("orphan");
    });
});

describe("a local branch is work only if newer than the claim (issue #6223)", () => {
    const CLAIM = Date.parse("2026-10-21T08:00:00Z");
    const sec = (iso: string) => String(Date.parse(iso) / 1000);
    const runner =
        (ct: string, worktrees = "", status = ""): ShRunner =>
        (_cmd, args) => {
            if (args[0] === "log") return ct;
            if (args[0] === "worktree") return worktrees;
            if (args.includes("status")) return status;
            throw new Error(`unexpected ${args.join(" ")}`);
        };
    const local = ["staging", "fix/issue-7"];

    it("a commit after the claim is work", () => {
        expect(
            localWorkSince(
                7,
                CLAIM,
                local,
                "origin/staging",
                runner(sec("2026-10-21T09:00:00Z"))
            )
        ).toBe(true);
    });

    it("a branch whose newest own commit predates the claim, with no worktree, is not", () => {
        expect(
            localWorkSince(
                7,
                CLAIM,
                local,
                "origin/staging",
                runner(sec("2026-10-12T09:00:00Z"))
            )
        ).toBe(false);
        // No commit past the base at all.
        expect(
            localWorkSince(7, CLAIM, local, "origin/staging", runner(""))
        ).toBe(false);
    });

    it("an uncommitted edit after the claim is work; one before it is not", () => {
        const wt = "worktree /w/7\nHEAD abc\nbranch refs/heads/fix/issue-7\n";
        const r = runner("", wt, " M scripts/a.ts");
        const at = (ms: number) => () => ms;
        expect(
            localWorkSince(
                7,
                CLAIM,
                local,
                "origin/staging",
                r,
                at(CLAIM + 60_000)
            )
        ).toBe(true);
        expect(
            localWorkSince(
                7,
                CLAIM,
                local,
                "origin/staging",
                r,
                at(CLAIM - 60_000)
            )
        ).toBe(false);
    });

    it("the FIRST status line, trimmed by `shChecked`, keeps its whole path", () => {
        const wt = "worktree /w/7\nHEAD abc\nbranch refs/heads/fix/issue-7\n";
        const seen: string[] = [];
        const at = (p: string) => {
            seen.push(p);
            return CLAIM + 60_000;
        };
        expect(
            localWorkSince(
                7,
                CLAIM,
                local,
                "origin/staging",
                runner("", wt, "M scripts/a.ts\n M scripts/b.ts"),
                at
            )
        ).toBe(true);
        expect(seen[0]).toBe("/w/7/scripts/a.ts");
        expect(porcelainPath("M scripts/a.ts")).toBe("scripts/a.ts");
        expect(porcelainPath(" M scripts/a.ts")).toBe("scripts/a.ts");
        expect(porcelainPath("R  old.ts -> new.ts")).toBe("new.ts");
        expect(porcelainPath("?? dir/")).toBe("dir/");
    });

    it("an edit whose age cannot be read (a deletion) is unknown, never `not work`", () => {
        const wt = "worktree /w/7\nHEAD abc\nbranch refs/heads/fix/issue-7\n";
        expect(
            localWorkSince(
                7,
                CLAIM,
                local,
                "origin/staging",
                runner("", wt, " D scripts/gone.ts"),
                () => null
            )
        ).toBeNull();
    });

    it("an unreadable branch is unknown, never `not work`", () => {
        const boom: ShRunner = () => {
            throw new Error("git failed");
        };
        expect(
            localWorkSince(7, CLAIM, local, "origin/staging", boom)
        ).toBeNull();
        expect(
            localWorkSince(7, NaN, local, "origin/staging", runner(""))
        ).toBeNull();
    });
});

describe("claim times from one GraphQL search (issue #6223)", () => {
    it("takes each issue's newest `in-progress` label event; others stay unknown", () => {
        const text = JSON.stringify({
            data: {
                search: {
                    nodes: [
                        {
                            number: 7,
                            timelineItems: {
                                nodes: [
                                    {
                                        createdAt: "2026-10-20T01:00:00Z",
                                        label: { name: "in-progress" },
                                    },
                                    {
                                        createdAt: "2026-10-20T02:00:00Z",
                                        label: { name: "bug" },
                                    },
                                    {
                                        createdAt: "2026-10-21T03:00:00Z",
                                        label: { name: "in-progress" },
                                    },
                                ],
                            },
                        },
                        { number: 8, timelineItems: { nodes: [] } },
                        { number: 99, timelineItems: { nodes: [] } },
                    ],
                },
            },
        });
        expect(parseClaimTimes(text, [7, 8])).toEqual({
            7: "2026-10-21T03:00:00Z",
            8: null,
        });
        expect(parseClaimTimes("not json", [7])).toEqual({});
    });
});

describe("one caller path for the claim verdict (issue #6223)", () => {
    const src = (rel: string) =>
        readFileSync(join(__dirname, "..", rel), "utf8");

    it("the dispatcher judges claims through `classifyClaims`, never a private rule", () => {
        const script = src("afk-dispatch.ts");
        expect(script).toMatch(/classifyClaims\(/);
        expect(script).toMatch(/from "\.\/lib\/claim-verdict"/);
        // The picker and the dispatcher's decisions consume a verdict state;
        // none of the evidence a liveness rule is made of appears there.
        for (const rel of [
            "lib/picker.ts",
            "lib/afk-dispatch.ts",
            "afk-dispatch.ts",
        ])
            expect(src(rel)).not.toMatch(
                /\b(liveRun|branchPushed|hasRemoteBranch|hasLocalBranch)\b/
            );
    });
});
