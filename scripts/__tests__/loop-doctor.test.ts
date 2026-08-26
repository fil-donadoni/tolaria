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
        // amber band (`scripts/dashboard/now-claims-table.js`'s
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

    it("AC2 — a PUSHED branch is left alone whatever its age, dead owner or not", () => {
        // The owner process of a pushed branch is routinely gone — the pass
        // ended, the branch is waiting on review or the merge-train. Age and
        // owner-death together must still not touch it.
        expect(
            classifyClaim({
                ...base,
                hasRemoteBranch: true,
                ageHours: 500,
                ownerAlive: false,
            }).state
        ).toBe("live");
        expect(
            classifyClaim({ ...base, hasOpenPr: true, ownerAlive: false }).state
        ).toBe("live");
    });

    it("AC3 — a claim younger than the classifier's threshold survives a dead owner reading", () => {
        // This is the case a naive "no process → release it" sweep gets
        // wrong. A pass claims its batch and only THEN spawns the subagents
        // that push branches; the owner probe can also simply fail to resolve
        // a pid. Neither may shortcut the age rule the classifier already
        // owns — otherwise the sweep releases a batch that is mid-claim.
        const v = classifyClaim({ ...base, ageHours: 0.5, ownerAlive: false });
        expect(v.state).toBe("suspect");
        expect(v.reason).toMatch(/healthy pass/);
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

    it("AC6 — an UNKNOWN owner changes no verdict the classifier would have reached without it", () => {
        // `null` is what every pre-#2627 ledger row and every failed probe
        // yields. Reading it as "dead" would quietly widen what the sweep
        // releases; reading it as "alive" would freeze the queue. It must do
        // neither: same verdict, same reason, as the ownerAlive-less facts.
        for (const facts of [
            base,
            { ...base, ageHours: 0.5 },
            { ...base, hasLocalBranch: true, ageHours: 30 },
            { ...base, hasLocalBranch: true, ageHours: 6 },
        ]) {
            expect(classifyClaim({ ...facts, ownerAlive: null })).toEqual(
                classifyClaim({ ...facts, ownerAlive: false })
            );
        }
    });

    it("adds no second age threshold — liveness is a veto, never a clock", () => {
        // AC: "The existing claim classifier is the sole authority; no second
        // age threshold is added." Sweeping the two thresholds across the
        // whole age range with a DEAD owner must reproduce the pre-#2627
        // verdict boundaries exactly: 2h with no branch, 24h with a local one.
        for (const ageHours of [0, 1.99, 2, 5, 23.9, 24, 100]) {
            expect(
                classifyClaim({ ...base, ageHours, ownerAlive: false }).state
            ).toBe(ageHours < 2 ? "suspect" : "orphan");
            expect(
                classifyClaim({
                    ...base,
                    hasLocalBranch: true,
                    ageHours,
                    ownerAlive: false,
                }).state
            ).toBe(ageHours < 24 ? "live" : "orphan");
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
