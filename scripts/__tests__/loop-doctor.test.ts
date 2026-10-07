import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
    classifyClaim,
    buildClaimFacts,
    parseClaimOwners,
    isOwnerAlive,
    interpretPsResult,
    defaultProcessProbe,
    releaseRecord,
    DEFAULT_MIN_AGE_HOURS,
    CLAIM_VERDICT_STATES,
    countUnpushedCommits,
    classifyClaims,
    worktreeQuietMinutes,
    fetchOpenPrs,
    openPrFor,
    type ClaimFacts,
    type ClaimedIssue,
    type ClaimOwner,
    type ProcessProbe,
} from "../loop-doctor";

/**
 * `loop:doctor` releases claims. The sessions share one GitHub account, so a
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
    ownerAlive: null,
    unpushedCommits: null,
};

describe("loop-doctor — classifyClaim", () => {
    it("calls an old claim with no branch and no PR an orphan", () => {
        const v = classifyClaim(base);
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/no branch, no PR/);
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

    it("takes the age threshold as a parameter, and the boundary is inclusive-above", () => {
        expect(classifyClaim({ ...base, ageHours: 2 }).state).toBe("orphan");
        expect(classifyClaim({ ...base, ageHours: 1.99 }).state).toBe(
            "suspect"
        );
        expect(classifyClaim({ ...base, ageHours: 5 }, 6).state).toBe(
            "suspect"
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
            classifyClaim({ ...base, ageHours: DEFAULT_MIN_AGE_HOURS }).state
        ).toBe("orphan");
        expect(
            classifyClaim({ ...base, ageHours: DEFAULT_MIN_AGE_HOURS - 0.01 })
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
 * `buildClaimFacts` (#2519) is the extraction `loop:status` reuses — it used
 * to be inlined inside loop-doctor's `import.meta.main` block, unreachable
 * from anywhere else. Testing it here pins the exact matching rules
 * (branch-suffix boundary, `refs/heads/` stripping, PR-branch-set lookup) so
 * a future edit to loop-doctor's CLI does not silently drift from what
 * loop-status.ts assumes it does.
 */
describe("loop-doctor — recoverable: a dead owner that left commits (#3698)", () => {
    const dead = {
        ...base,
        hasLocalBranch: true,
        ownerAlive: false as boolean | null,
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

    it("needs a POSITIVE death reading — unknown liveness changes no verdict", () => {
        // The mirror of the `ownerAlive === true` rule above, and the same
        // asymmetry: this subsystem's failure mode is declaring a healthy
        // concurrent pass dead, so `null` keeps the verdicts it had before.
        const unknown = classifyClaim({
            ...dead,
            ownerAlive: null,
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

    it("a PUSHED branch is never `recoverable` — its commits are not unpushed at all (a dead owner makes it `stranded`, issue #4763)", () => {
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

describe("loop-doctor — stranded: a dead owner that left PUSHED work (issue #4763)", () => {
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
        it(`${what} + a PROVABLY dead owner is \`stranded\` — not live, not orphan, not recoverable`, () => {
            const v = classifyClaim(pushed({ ...facts, ownerAlive: false }));
            expect(v.state).toBe("stranded");
            expect(v.reason).toMatch(/label is NOT released/);
        });

        it(`${what} with an UNKNOWN or live owner stays \`live\``, () => {
            // `null` = could not tell; only a positive death reading moves it.
            for (const ownerAlive of [null, true]) {
                expect(
                    classifyClaim(pushed({ ...facts, ownerAlive })).state
                ).toBe("live");
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
            owners: new Map(),
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

describe("loop-doctor — countUnpushedCommits (#3698)", () => {
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

describe("loop-doctor — buildClaimFacts", () => {
    const issue: ClaimedIssue = {
        number: 2519,
        title: "loop:status",
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
 * Owner liveness (#2627) — the four acceptance cases of "reap orphaned claims
 * by evidence, not after 24h".
 *
 * The whole point of the fact is that it can only ever HOLD a claim, never
 * release one: the failure mode of this sweep is unclaiming a healthy
 * concurrent pass, and a liveness reading we are unsure about must not be
 * what authorises a release. Every case below is written from that direction.
 */
describe("loop-doctor — owner liveness (#2627)", () => {
    it("AC1 — no branch, no PR and a provably dead owner is an orphan", () => {
        const v = classifyClaim({ ...base, ownerAlive: false });
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/no branch, no PR/);
    });

    it("AC2 — a PUSHED branch is never released whatever its age; a dead owner makes it `stranded`, not `orphan` (issue #4763)", () => {
        // Age and owner-death together must still not RELEASE pushed work.
        // Since issue #4763 they no longer read `live` either: under ADR 0110
        // nothing lands a PR whose pass is gone, so that pass holds no session
        // — `stranded` keeps the label and gives up the cap slot.
        expect(
            classifyClaim({
                ...base,
                hasRemoteBranch: true,
                ageHours: 500,
                ownerAlive: false,
            }).state
        ).toBe("stranded");
        expect(
            classifyClaim({ ...base, hasOpenPr: true, ownerAlive: false }).state
        ).toBe("stranded");
    });

    it("AC3 — a PROVABLY dead owner skips the age rule: no branch is an orphan at once (issue #5174)", () => {
        // The age rule stands in for "is anyone still working on this" when
        // we cannot see the process. The owner stamp is the claiming `claude`
        // process itself (`queue:claim`'s `ownerStamp`), so a dead reading
        // answers the question directly: a pass mid-claim is alive.
        const v = classifyClaim({ ...base, ageHours: 0.5, ownerAlive: false });
        expect(v.state).toBe("orphan");
        expect(v.reason).toMatch(/owning process is gone/);
    });

    it("a dead owner's claim minutes old is still `suspect` — the journal row moving the owner may not be written yet (issue #5174)", () => {
        // `queue:claim` adds the label, THEN appends the row naming the new
        // owner; in between, the journal can name a previous dead claimant.
        for (const minutes of [0, 1, 4.9]) {
            expect(
                classifyClaim({
                    ...base,
                    ageHours: minutes / 60,
                    ownerAlive: false,
                }).state
            ).toBe("suspect");
        }
        expect(
            classifyClaim({ ...base, ageHours: 5 / 60, ownerAlive: false })
                .state
        ).toBe("orphan");
    });

    it("a dead owner whose worktree changed recently is `live` — a `claude --resume` gets a new pid (issue #5174)", () => {
        const dead = {
            ...base,
            hasLocalBranch: true,
            ownerAlive: false,
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

    it("AC4 — a live owning process holds the claim, at any age and with no branch", () => {
        const v = classifyClaim({ ...base, ageHours: 500, ownerAlive: true });
        expect(v.state).toBe("live");
        expect(v.reason).toMatch(/owning process still alive/);
    });

    it("AC4 — a live owner also outranks the local-only-branch orphan rule", () => {
        // A pass 30h into an implementation without pushing is the shape the
        // 24h rule was written to reap; if its process is demonstrably still
        // running, it is not that shape at all.
        expect(
            classifyClaim({
                ...base,
                hasLocalBranch: true,
                ageHours: 30,
                ownerAlive: true,
            }).state
        ).toBe("live");
    });

    it("AC6 — an UNKNOWN owner keeps the age-rule verdicts", () => {
        // `null` is what every pre-#2627 ledger row and every failed probe
        // yields. Reading it as "dead" would quietly widen what the sweep
        // releases; reading it as "alive" would freeze the queue. It must do
        // neither: the 2h / 24h age rules decide, as before #2627.
        for (const [facts, state] of [
            [base, "orphan"],
            [{ ...base, ageHours: 0.5 }, "suspect"],
            [{ ...base, hasLocalBranch: true, ageHours: 30 }, "orphan"],
            [{ ...base, hasLocalBranch: true, ageHours: 6 }, "live"],
        ] as const) {
            expect(classifyClaim({ ...facts, ownerAlive: null }).state).toBe(
                state
            );
        }
    });

    it("the age thresholds bind an UNKNOWN owner only — a dead one has none (issue #5174)", () => {
        for (const ageHours of [0, 1.99, 2, 5, 23.9, 24, 100]) {
            expect(
                classifyClaim({ ...base, ageHours, ownerAlive: null }).state
            ).toBe(ageHours < 2 ? "suspect" : "orphan");
            expect(
                classifyClaim({
                    ...base,
                    hasLocalBranch: true,
                    ageHours,
                    ownerAlive: null,
                }).state
            ).toBe(ageHours < 24 ? "live" : "orphan");
            expect(
                classifyClaim({ ...base, ageHours, ownerAlive: false }).state
            ).toBe(ageHours === 0 ? "suspect" : "orphan");
            expect(
                classifyClaim({
                    ...base,
                    hasLocalBranch: true,
                    ageHours,
                    ownerAlive: false,
                }).state
            ).toBe("recoverable");
        }
    });
});

/**
 * The JOIN. `claims.jsonl` keys rows by Claude Code session UUID, and a
 * session UUID is not a process handle — it is in no argv, and Claude Code
 * holds no open descriptor on its own transcript (measured 2026-08-25), so it
 * cannot be resolved to a pid after the fact. The pid is therefore RECORDED at
 * claim time by `claim-ledger.sh`, and this is the reader.
 */
describe("loop-doctor — parseClaimOwners", () => {
    const row = (o: Record<string, unknown>) => JSON.stringify(o);

    it("reads the owner recorded on a claim row", () => {
        const owners = parseClaimOwners(
            row({
                ts: 1,
                session: "sess-A",
                issue: 2627,
                event: "claim",
                owner: { pid: 4242, startedAt: "Mon Aug 24 09:00:00 2026" },
            })
        );
        expect(owners.get(2627)).toEqual({
            session: "sess-A",
            pid: 4242,
            startedAt: "Mon Aug 24 09:00:00 2026",
        });
    });

    it("yields no owner for a row written before the owner field existed", () => {
        // Every historical row. Absent owner must read as UNKNOWN, which the
        // classifier ignores — not as a dead owner, which it would act on.
        const owners = parseClaimOwners(
            row({ ts: 1, session: "s", issue: 2627, event: "claim" }) +
                "\n" +
                row({
                    ts: 2,
                    session: "s",
                    issue: 2628,
                    event: "claim",
                    owner: null,
                })
        );
        expect(owners.has(2627)).toBe(false);
        expect(owners.has(2628)).toBe(false);
        expect(isOwnerAlive(owners.get(2627))).toBeNull();
    });

    it("a release clears the owner, and the LAST row for an issue wins", () => {
        const owners = parseClaimOwners(
            [
                row({
                    ts: 1,
                    session: "s",
                    issue: 7,
                    event: "claim",
                    owner: { pid: 1, startedAt: "t1" },
                }),
                row({ ts: 2, session: "s", issue: 7, event: "released" }),
                row({
                    ts: 3,
                    session: "s2",
                    issue: 7,
                    event: "claim",
                    owner: { pid: 2, startedAt: "t2" },
                }),
            ].join("\n")
        );
        expect(owners.get(7)?.pid).toBe(2);
        expect(
            parseClaimOwners(
                [
                    row({
                        ts: 1,
                        session: "s",
                        issue: 7,
                        event: "claim",
                        owner: { pid: 1, startedAt: "t1" },
                    }),
                    row({ ts: 2, session: "s", issue: 7, event: "released" }),
                ].join("\n")
            ).has(7)
        ).toBe(false);
    });

    it("skips a torn or malformed line instead of throwing", () => {
        // The journal is appended to by a shell hook under `2>/dev/null`; a
        // half-written last line is a normal thing to find, and refusing to
        // sweep because of one is worse than ignoring it.
        const owners = parseClaimOwners(
            [
                "{not json",
                row({ ts: 1, session: "s", issue: 9, event: "claim" }),
                row({
                    ts: 2,
                    session: "s",
                    issue: 8,
                    event: "claim",
                    owner: { pid: 3, startedAt: "t" },
                }),
                '{"ts":3,"session":"s","issue":',
            ].join("\n")
        );
        expect(owners.get(8)?.pid).toBe(3);
    });

    it("rejects an owner whose pid or start time is unusable", () => {
        const owners = parseClaimOwners(
            [
                row({
                    ts: 1,
                    session: "s",
                    issue: 1,
                    event: "claim",
                    owner: { pid: 0, startedAt: "t" },
                }),
                row({
                    ts: 1,
                    session: "s",
                    issue: 2,
                    event: "claim",
                    owner: { pid: 5, startedAt: "" },
                }),
                row({
                    ts: 1,
                    session: "s",
                    issue: 3,
                    event: "claim",
                    owner: { pid: "5", startedAt: "t" },
                }),
            ].join("\n")
        );
        expect([...owners.keys()]).toEqual([]);
    });
});

describe("loop-doctor — isOwnerAlive", () => {
    const owner: ClaimOwner = {
        session: "s",
        pid: 4242,
        startedAt: "Mon Aug 24 09:00:00 2026",
    };
    const probe =
        (result: string | null): ProcessProbe =>
        () =>
            result;

    it("alive when the pid resolves to a process that started when we recorded", () => {
        expect(isOwnerAlive(owner, probe("Mon Aug 24 09:00:00 2026"))).toBe(
            true
        );
    });

    it("dead when there is no such process", () => {
        expect(isOwnerAlive(owner, probe(""))).toBe(false);
    });

    it("dead when the pid was RECYCLED — same number, different process", () => {
        // Without the start-time column a dead pass reads as alive again the
        // moment the OS hands its number to something else, which is the one
        // way this fact could actively make the bug worse.
        expect(isOwnerAlive(owner, probe("Tue Aug 25 11:11:11 2026"))).toBe(
            false
        );
    });

    it("UNKNOWN, never dead, when the probe itself could not answer", () => {
        expect(isOwnerAlive(owner, probe(null))).toBeNull();
        expect(isOwnerAlive(undefined, probe(""))).toBeNull();
    });

    it("tolerates whitespace differences in the recorded start time", () => {
        expect(isOwnerAlive(owner, probe("  Mon Aug 24 09:00:00 2026  "))).toBe(
            true
        );
    });
});

describe("loop-doctor — release record (#2627 AC5)", () => {
    it("records what was reclaimed, why, and which session had held it", () => {
        const verdict = classifyClaim({ ...base, ownerAlive: false });
        const line = JSON.parse(
            releaseRecord(
                2627,
                verdict,
                {
                    session: "sess-dead",
                    pid: 7,
                    startedAt: "t",
                },
                1_787_590_847_000
            )
        );
        expect(line).toEqual({
            ts: 1_787_590_847,
            // Stamped with the OWNING session, not the tool's name, so the
            // dead session's own SessionEnd sweep folds this claim out too.
            session: "sess-dead",
            issue: 2627,
            event: "released",
            by: "loop:doctor",
            verdict: "orphan",
            reason: verdict.reason,
        });
    });

    it("falls back to naming itself when the claim had no recorded owner", () => {
        const line = JSON.parse(
            releaseRecord(1, classifyClaim(base), undefined, 0)
        );
        expect(line.session).toBe("loop:doctor");
        expect(line.by).toBe("loop:doctor");
    });
});

describe("loop-doctor — buildClaimFacts threads owner liveness", () => {
    const issue: ClaimedIssue = {
        number: 2627,
        title: "reap",
        updatedAt: "2026-08-17T00:00:00Z",
    };
    const facts = (ownerAlive?: boolean | null): ClaimFacts =>
        buildClaimFacts(
            issue,
            new Set(),
            { local: [], remote: [] },
            new Date("2026-08-18T00:00:00Z").getTime(),
            ownerAlive
        );

    it("carries the caller's liveness reading onto the facts", () => {
        expect(facts(true).ownerAlive).toBe(true);
        expect(facts(false).ownerAlive).toBe(false);
    });

    it("defaults to UNKNOWN so every pre-existing caller keeps its verdicts", () => {
        // `lib/loop-status.ts` (the verdict engine, #2624) calls this with
        // four arguments and must be unaffected: the process check is I/O and
        // belongs at the fact-gathering boundary, not inside a pure
        // classifier that the dashboard also renders from.
        expect(facts().ownerAlive).toBeNull();
        expect(classifyClaim(facts())).toEqual(classifyClaim(facts(null)));
    });
});

/**
 * The real probe. `isOwnerAlive`'s branches are exercised through an injected
 * probe above — which leaves the injectee itself, the only piece that touches
 * a process, unasserted. The dangerous confusion lives exactly here: "no such
 * process" authorises a release, "the probe failed" must not, and both are
 * non-zero exits of the same command.
 */
describe("loop-doctor — defaultProcessProbe / interpretPsResult", () => {
    it("maps ps's four outcomes, keeping 'probe failed' distinct from 'process gone'", () => {
        expect(
            interpretPsResult({
                status: 0,
                stdout: " Mon Aug 24 09:00:00 2026 ",
            })
        ).toBe("Mon Aug 24 09:00:00 2026");
        // exit 1 = `ps -p` matched nothing = the process really is gone.
        expect(interpretPsResult({ status: 1, stdout: "" })).toBe("");
        // Anything else is the probe failing. Reading it as "gone" would let a
        // broken `ps` release every claim on the board.
        expect(interpretPsResult({ status: 2, stdout: "" })).toBeNull();
        expect(interpretPsResult({ status: null, stdout: "" })).toBeNull();
        expect(
            interpretPsResult({ error: new Error("ENOENT"), status: null })
        ).toBeNull();
        // Success with nothing to say is not evidence either.
        expect(interpretPsResult({ status: 0, stdout: "   " })).toBeNull();
    });

    it("reads a LIVE process's start time, matching what ps itself reports", () => {
        const mine = defaultProcessProbe(process.pid);
        expect(mine).not.toBeNull();
        expect(mine).not.toBe("");
        // The reference `ps` carries the same locale/zone pin the probe does
        // — `lstart` is a localised, zoned human string, so an unpinned
        // reference would agree only by the accident of this machine's
        // LANG/TZ. See the stability test below.
        expect(mine).toBe(
            spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], {
                encoding: "utf8",
                env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
            }).stdout.trim()
        );
    });

    it("returns the SAME stamp whatever LANG/TZ this process inherits", () => {
        // The read side of the same hazard the claim hook has on the write
        // side. `ps -o lstart=` renders through locale AND timezone: measured
        // on one machine, same process, same instant — `Tue Aug 25 09:15:42
        // 2026` by default, `Di. 25 Aug. 09:15:42 2026` under `LC_TIME=de_DE`,
        // `Tue Aug 25 07:15:42 2026` under `TZ=UTC`. `isOwnerAlive` compares
        // write-side and read-side stamps as exact trimmed strings, so if this
        // reader drifted with its ambient environment a LIVE owner would read
        // as a recycled pid and the claim would fall back to the age
        // thresholds — safe, silent, and the feature quietly inert.
        const saved = {
            LANG: process.env.LANG,
            LC_TIME: process.env.LC_TIME,
            LC_ALL: process.env.LC_ALL,
            TZ: process.env.TZ,
        };
        const plain = defaultProcessProbe(process.pid);
        try {
            process.env.LANG = "de_DE.UTF-8";
            process.env.LC_TIME = "de_DE.UTF-8";
            delete process.env.LC_ALL;
            process.env.TZ = "Asia/Tokyo";
            expect(defaultProcessProbe(process.pid)).toBe(plain);
        } finally {
            for (const [k, v] of Object.entries(saved)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
        // …and the pinned string is the C-locale one, chosen rather than
        // inherited.
        expect(plain).toMatch(
            /^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/
        );
    });

    it("reads a REAPED pid as gone, not as unknown", () => {
        // A pid that certainly existed and certainly does not now: spawnSync
        // returns only after the child is reaped.
        const dead = spawnSync("sh", ["-c", "exit 0"]);
        expect(dead.pid).toBeGreaterThan(0);
        expect(defaultProcessProbe(dead.pid!)).toBe("");
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
            return " M scripts/a.ts\nR  old.ts -> new.ts\n?? b.md\n";
        throw new Error(`unexpected ${args.join(" ")}`);
    };

    it("is the age of the NEWEST of index and status paths, found by branch", () => {
        const mtimes: Record<string, number> = {
            "/repo/.git/worktrees/x/index": now - 50 * 60000,
            "/repo-issue-42/scripts/a.ts": now - 40 * 60000,
            "/repo-issue-42/new.ts": now - 7 * 60000,
            "/repo-issue-42/b.md": now - 90 * 60000,
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
