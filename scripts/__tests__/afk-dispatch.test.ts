import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
    ACK_MARKER,
    agedRepairLines,
    agedRepairNotice,
    budgetReading,
    failureStreak,
    holdAdmitsRepairs,
    holdFor,
    holdReleases,
    hostOfRunnerName,
    livePassIssues,
    repairAttempted,
    mayClaim,
    parseAfkDispatchConfig,
    parsePassRecord,
    parseTrustedAuthors,
    passRunIssue,
    passSlots,
    planDispatch,
    planRepairsUnderHold,
    queueAdmission,
    queueDepth,
    usageLimitResetAt,
    type FailureStreak,
    type Hold,
    type HoldInput,
    type OpenPr,
    type PassRecord,
    type RunnerRow,
    type WorkflowRun,
} from "../lib/afk-dispatch";
import { claimFate, pick } from "../lib/picker";
import { classifyClaims } from "../loop-doctor";
import {
    repairItems,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "../lib/queue-plan";

// The AFK dispatcher's decisions (issue #5649). Every hold, the claim-facts
// rules and the slot arithmetic are pinned here on hand-built facts; the
// one-run-at-a-time guarantee is the workflow's concurrency group, pinned by
// the structure guard (scripts/__tests__/workflow-structure.test.ts) — and
// by the double-claim block below, which drives two dispatcher runs in
// sequence through the real picker.

const NOW = Date.parse("2026-10-16T12:00:00Z");
const iso = (minutesAgo: number) =>
    new Date(NOW - minutesAgo * 60_000).toISOString();

function run(
    id: number,
    title: string,
    over: Partial<WorkflowRun> = {}
): WorkflowRun {
    return {
        id,
        title,
        status: "completed",
        conclusion: "success",
        createdAt: iso(100 - id),
        updatedAt: iso(90 - id),
        ...over,
    };
}

const passRun = (id: number, issue: number, over: Partial<WorkflowRun> = {}) =>
    run(id, `afk-pass #${issue}`, over);

function record(over: Partial<PassRecord> = {}): PassRecord {
    return {
        version: 1,
        issue: 1,
        pr: null,
        outcome: "handed-off",
        host: "huawei",
        startedAt: iso(60),
        endedAt: iso(30),
        durationS: 1800,
        models: {
            "claude-sonnet-5-5": {
                input: 1000,
                output: 0,
                cacheCreation: 0,
                cacheRead: 0,
            },
        },
        costUsd: 1,
        usageLimitResetAt: null,
        ...over,
    };
}

/** The dispatcher's claim verdicts — `classifyClaims`, the one authority
 *  (issue #6223) — over runs, pushed branches and PRs, with no journal owner
 *  and no local branch (this machine's evidence is pinned in
 *  `loop-doctor.test.ts`). Every claim was taken well before the runs listed
 *  (a run after the claim is the pipeline's evidence), unless `at` says
 *  otherwise. */
function facts(
    claimed: number[],
    runs: WorkflowRun[],
    branches: string[],
    prs: OpenPr[],
    at: Record<number, string | null> = {}
) {
    const prMap = new Map(prs.map((p) => [p.headRefName, p.number]));
    const landQueue = new Map(
        prs.flatMap((p) =>
            p.labels.includes("land-failed")
                ? [[p.headRefName, "failed" as const]]
                : p.labels.includes("ready-to-land")
                  ? [[p.headRefName, "ready" as const]]
                  : []
        )
    );
    return classifyClaims(
        claimed.map((n) => ({
            number: n,
            title: "x",
            updatedAt: iso(0),
            claimedAt: n in at ? at[n] : iso(500),
        })),
        {
            prBranches: new Set(prMap.keys()),
            prs: prMap,
            landQueue,
            branches: { local: [], remote: branches },
            owners: new Map(),
            baseRef: "origin/staging",
            now: NOW,
            passRuns: runs,
        }
    ).map((c) => ({ issue: c.issue, state: c.verdict.state, pr: c.pr }));
}

const NO_STREAK: FailureStreak = { runs: [], notify: false };

function holdInput(over: Partial<HoldInput> = {}): HoldInput {
    return {
        dispatcherActive: true,
        passWorkflowActive: true,
        healthError: null,
        missingRecords: 0,
        streak: NO_STREAK,
        red: null,
        usageLimitResetAt: null,
        budget: { budget: 10_000, maxPct: 80, hours: 5 },
        reading: { weighted: 1000, pct: 10, remote: 0 },
        ...over,
    };
}

describe("afk-dispatch holds (issue #5649)", () => {
    it("dispatches when nothing holds", () => {
        expect(holdFor(holdInput())).toBeNull();
    });

    it("a spent budget holds dispatch", () => {
        const h = holdFor(
            holdInput({ reading: { weighted: 8000, pct: 80, remote: 0 } })
        );
        expect(h?.kind).toBe("budget");
        expect(
            holdFor(
                holdInput({
                    reading: { weighted: 7999, pct: 79.99, remote: 0 },
                })
            )
        ).toBeNull();
    });

    it("an unset budget holds (never unbudgeted, ADR 0109)", () => {
        const h = holdFor(
            holdInput({ budget: { budget: 0, maxPct: 80, hours: 5 } })
        );
        expect(h?.kind).toBe("no-budget");
    });

    it("the budget counts the other machine's passes, never this machine's twice", () => {
        const local = {
            "claude-sonnet-5-5": {
                input: 1000,
                output: 0,
                cacheCreation: 0,
                cacheRead: 0,
            },
        };
        const since = NOW - 5 * 3_600_000;
        const here = record({ host: "macbook" });
        const there = record({ host: "huawei" });
        const old = record({ host: "huawei", endedAt: iso(6 * 60) });
        const r = budgetReading(
            local,
            [here, there, old],
            "macbook",
            since,
            10_000
        );
        // Sonnet input weighs 1: 1000 local + 1000 from huawei's in-window pass.
        expect(r.remote).toBe(1000);
        expect(r.weighted).toBe(2000);
        expect(r.pct).toBe(20);
    });

    it("a usage-limit reset time in the future holds until it passes", () => {
        const until = iso(-45);
        const at = usageLimitResetAt(
            [
                record({ usageLimitResetAt: iso(10) }),
                record({ usageLimitResetAt: until }),
            ],
            NOW
        );
        expect(at).toBe(until);
        const h = holdFor(holdInput({ usageLimitResetAt: at }));
        expect(h).toMatchObject({ kind: "usage-limit", until });
        expect(
            usageLimitResetAt([record({ usageLimitResetAt: iso(1) })], NOW)
        ).toBeNull();
    });

    it("a RED base holds dispatch", () => {
        const h = holdFor(
            holdInput({ red: { sha: "abcdef1234", failedStep: "test:app" } })
        );
        expect(h?.kind).toBe("red");
        expect(h?.message).toContain("abcdef12");
    });

    it("the kill switch holds a run queued before it", () => {
        expect(holdFor(holdInput({ dispatcherActive: false }))?.kind).toBe(
            "disabled"
        );
    });

    it("unknown facts hold: an unreadable verdict, a missing pass record, a zero window", () => {
        expect(holdFor(holdInput({ healthError: "HTTP 502" }))?.kind).toBe(
            "unknown-health"
        );
        expect(holdFor(holdInput({ missingRecords: 1 }))?.kind).toBe(
            "records-unknown"
        );
        expect(
            holdFor(
                holdInput({ budget: { budget: 10_000, maxPct: 80, hours: 0 } })
            )?.kind
        ).toBe("no-budget");
    });

    it("a missing pass workflow holds before anything else", () => {
        const h = holdFor(
            holdInput({
                passWorkflowActive: false,
                red: { sha: "x" },
            })
        );
        expect(h?.kind).toBe("no-pass-workflow");
    });
});

describe("afk-dispatch failure streak (issue #5649)", () => {
    const failed = (id: number, minutesAgo: number) =>
        passRun(id, id, {
            conclusion: "failure",
            updatedAt: iso(minutesAgo),
            createdAt: iso(minutesAgo + 10),
        });

    it("three consecutive failed passes hold, and the first run notifies", () => {
        const runs = [failed(1, 30), failed(2, 20), failed(3, 10)];
        const s = failureStreak(runs, []);
        expect(s.runs.map((r) => r.id)).toEqual([3, 2, 1]);
        expect(s.notify).toBe(true);
        expect(holdFor(holdInput({ streak: s }))).toMatchObject({
            kind: "failure-streak",
            notify: true,
        });
    });

    it("notifies once: a failed dispatcher run after the streak silences it", () => {
        const runs = [failed(1, 30), failed(2, 20), failed(3, 10)];
        const emailed = run(50, "afk-dispatch", {
            conclusion: "failure",
            createdAt: iso(5),
            updatedAt: iso(4),
        });
        const s = failureStreak(runs, [emailed]);
        expect(s.runs).toHaveLength(3);
        expect(s.notify).toBe(false);
    });

    it("the dispatcher run the third failing pass sent counts as the email, though created before it completed", () => {
        const runs = [failed(1, 30), failed(2, 20), failed(3, 10)];
        // Created while pass 3 still ran (11 min ago), failed after it (8).
        const emailed = run(51, "afk-dispatch", {
            conclusion: "failure",
            createdAt: iso(11),
            updatedAt: iso(8),
        });
        expect(failureStreak(runs, [emailed]).notify).toBe(false);
        // An older failure (before the streak) is not this streak's email.
        const stale = run(52, "afk-dispatch", {
            conclusion: "failure",
            createdAt: iso(40),
            updatedAt: iso(39),
        });
        expect(failureStreak(runs, [stale]).notify).toBe(true);
    });

    it("a success in between breaks the streak; a cancelled run is passed over", () => {
        const ok = passRun(9, 9, { updatedAt: iso(25) });
        expect(
            failureStreak([failed(1, 30), ok, failed(2, 20), failed(3, 10)], [])
                .runs
        ).toHaveLength(2);
        const killed = passRun(8, 8, {
            conclusion: "cancelled",
            updatedAt: iso(15),
        });
        expect(
            failureStreak(
                [failed(1, 30), failed(2, 20), killed, failed(3, 10)],
                []
            ).runs
        ).toHaveLength(3);
    });

    it("the owner's acknowledgement ends the streak", () => {
        const runs = [failed(1, 30), failed(2, 20), failed(3, 10)];
        const ack = run(60, `afk-dispatch (${ACK_MARKER})`, {
            createdAt: iso(5),
        });
        const s = failureStreak(runs, [ack]);
        expect(s.runs).toHaveLength(0);
        expect(holdFor(holdInput({ streak: s }))).toBeNull();
    });

    it("a running pass does not count", () => {
        const runs = [
            failed(1, 30),
            failed(2, 20),
            passRun(3, 3, { status: "in_progress", conclusion: null }),
        ];
        expect(failureStreak(runs, []).runs).toHaveLength(2);
    });
});

describe("afk-dispatch aged repair picks (issue #5957)", () => {
    const CONFIG = parseAfkDispatchConfig({});
    const HOLD: Hold = {
        kind: "no-pass-workflow",
        message: "afk-pass.yml is absent",
    };
    const hoursAgo = (h: number) => iso(h * 60);
    const repair = (pr: number, failedHoursAgo: number | null) => ({
        pr,
        failedAt: failedHoursAgo === null ? null : hoursAgo(failedHoursAgo),
        createdAt: hoursAgo(30),
    });
    const failedDispatch = (id: number, minutesAgo: number) =>
        run(id, "afk-dispatch", {
            conclusion: "failure",
            createdAt: iso(minutesAgo + 1),
            updatedAt: iso(minutesAgo),
        });

    it("a hold with a land-failed PR past the threshold fails the run, naming the PR, its age and the hold", () => {
        const n = agedRepairNotice(
            HOLD,
            [repair(10, 20), repair(11, 1)],
            [],
            CONFIG,
            NOW
        );
        expect(n.notify).toBe(true);
        expect(n.aged.map((a) => a.pr)).toEqual([10]);
        const [line] = agedRepairLines(n.aged, HOLD);
        expect(line).toContain("PR #10");
        expect(line).toContain("20.0 h");
        expect(line).toContain("no-pass-workflow");
    });

    it("the following runs, with the same condition, exit 0", () => {
        // The first run failed 2 h ago, after PR #10 crossed (16 h ago).
        const n = agedRepairNotice(
            HOLD,
            [repair(10, 20)],
            [failedDispatch(70, 120)],
            CONFIG,
            NOW
        );
        expect(n.aged).toHaveLength(1);
        expect(n.notify).toBe(false);
        // A second pick ageing while the first still waits is the same
        // condition: no second email.
        expect(
            agedRepairNotice(
                HOLD,
                [repair(10, 20), repair(12, 5)],
                [failedDispatch(70, 120)],
                CONFIG,
                NOW
            ).notify
        ).toBe(false);
    });

    it("the condition clears and returns: a pick ageing after the last email notifies again", () => {
        // The email 10 h ago was for an older condition; PR #13 crossed 1 h ago.
        expect(
            agedRepairNotice(
                HOLD,
                [repair(13, 5)],
                [failedDispatch(71, 600)],
                CONFIG,
                NOW
            ).notify
        ).toBe(true);
    });

    it("without an aged repair pick, or without a hold, nothing fails", () => {
        expect(
            agedRepairNotice(HOLD, [repair(11, 1)], [], CONFIG, NOW)
        ).toEqual({ aged: [], notify: false });
        expect(agedRepairNotice(HOLD, [], [], CONFIG, NOW).notify).toBe(false);
        expect(
            agedRepairNotice(null, [repair(10, 20)], [], CONFIG, NOW).notify
        ).toBe(false);
        // The kill switch is the owner's own stop: no email for it.
        expect(
            agedRepairNotice(
                { kind: "disabled", message: "off" },
                [repair(10, 20)],
                [],
                CONFIG,
                NOW
            ).notify
        ).toBe(false);
    });

    it("an unreadable label time counts from the PR's creation", () => {
        const n = agedRepairNotice(HOLD, [repair(14, null)], [], CONFIG, NOW);
        expect(n.aged.map((a) => a.pr)).toEqual([14]);
        expect(n.aged[0].ageHours).toBeCloseTo(30);
    });

    it("the threshold is config, with a default for a missing block", () => {
        expect(
            parseAfkDispatchConfig({ afkDispatch: { repairAgeHours: 9 } })
        ).toMatchObject({ repairAgeHours: 9 });
        expect(parseAfkDispatchConfig({})).toMatchObject({
            repairAgeHours: 4,
        });
        expect(
            agedRepairNotice(
                HOLD,
                [repair(10, 20)],
                [],
                { ...CONFIG, repairAgeHours: 24 },
                NOW
            ).notify
        ).toBe(false);
    });
});

describe("afk-dispatch claim facts (issue #5649)", () => {
    const pr = (issue: number, labels: string[] = []) => ({
        number: 9000 + issue,
        headRefName: `feat/issue-${issue}`,
        labels,
    });

    it("a claim with no afk-pass run at all belongs to a session outside the pipeline: held", () => {
        const [f] = facts([7], [], [], []);
        expect(claimFate(f)).toBe("live");
    });

    it("a claim newer than every run of its issue is held: a human's, or a dispatch not listed yet", () => {
        const old = passRun(1, 7, {
            conclusion: "failure",
            createdAt: iso(300),
        });
        const [f] = facts([7], [old], ["feat/issue-7"], [], { 7: iso(5) });
        expect(claimFate(f)).toBe("live");
        const [g] = facts([7], [old], [], [], { 7: iso(5) });
        expect(claimFate(g)).toBe("live");
        // Unknown claim time: held.
        const [h] = facts([7], [old], [], [], { 7: null });
        expect(claimFate(h)).toBe("live");
        // The run the claim dispatched (created after it): the pipeline's.
        const [k] = facts([7], [old], [], [], { 7: iso(400) });
        expect(claimFate(k)).toBe("release");
    });

    it("a claim with a running pass is held", () => {
        const [f] = facts(
            [7],
            [passRun(1, 7, { status: "in_progress", conclusion: null })],
            [],
            []
        );
        expect(f.state).toBe("live");
    });

    it("a claim whose PR waits in the queue is held; a land-failed PR is a dead pass's work", () => {
        const runs = [passRun(1, 7), passRun(2, 8)];
        const [queued, failed] = facts(
            [7, 8],
            runs,
            [],
            [pr(7, ["ready-to-land"]), pr(8, ["land-failed"])]
        );
        expect(queued.state).toBe("pr-open");
        expect(claimFate(queued)).toBe("live");
        expect(failed).toEqual({ issue: 8, state: "stranded", pr: 9008 });
        expect(claimFate(failed)).toBe("resume");
    });

    it("a dead pass with a pushed branch resumes; with none it is an orphan", () => {
        const runs = [passRun(1, 7, { conclusion: "failure" }), passRun(2, 8)];
        const [pushed, orphan] = facts(
            [7, 8],
            runs,
            ["fix/issue-7", "main"],
            []
        );
        expect(pushed.state).toBe("stranded");
        expect(orphan.state).toBe("orphan");
    });

    it("parses the pass run name and the runner name", () => {
        expect(passRunIssue("afk-pass #5649")).toBe(5649);
        expect(passRunIssue("afk-pass #5649 (resume)")).toBe(5649);
        expect(passRunIssue("afk-dispatch")).toBeNull();
        expect(hostOfRunnerName("huawei-pass-2")).toBe("huawei");
        expect(hostOfRunnerName("filippo-mbp-lane-1")).toBe("filippo-mbp");
        expect(hostOfRunnerName("random")).toBeNull();
    });

    it("claims only an issue still queued and unclaimed", () => {
        expect(mayClaim(["ready-for-agent"])).toBe(true);
        expect(mayClaim(["ready-for-agent", "in-progress"])).toBe(false);
        expect(mayClaim(["enhancement"])).toBe(false);
    });
});

const runner = (
    name: string,
    host: string,
    over: Partial<RunnerRow> = {}
): RunnerRow => ({
    name,
    status: "online",
    busy: false,
    labels: ["self-hosted", "pass", `host:${host}`],
    ...over,
});

describe("afk-dispatch slots (issue #5649)", () => {
    it("counts idle online pass runners, this runner, minus waiting passes", () => {
        const runners = [
            runner("mbp-pass-1", "mbp"),
            runner("mbp-pass-2", "mbp", { busy: true }),
            runner("hw-pass-1", "hw", { busy: true }),
            runner("hw-pass-2", "hw", { status: "offline" }),
            runner("hw-lane-1", "hw", {
                labels: ["self-hosted", "lane", "host:hw"],
            }),
        ];
        const s = passSlots(runners, "hw-pass-1", []);
        expect(s.free).toEqual(["mbp", "hw"]);
        expect(s.online.sort()).toEqual(["hw", "mbp"]);
        const waiting = [passRun(1, 1, { status: "queued", conclusion: null })];
        expect(passSlots(runners, "hw-pass-1", waiting).free).toEqual(["mbp"]);
    });
});

const CONFIG: PlanConfig = {
    batchCap: 4,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
    now: new Date(NOW).toISOString(),
    excludeHitl: true,
};

const BODY = (file: string) =>
    [
        "## What to build",
        "",
        "Some behaviour the loop needs, described at enough length that the body is a spec rather than a title repeated twice.",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] the behaviour above works end to end",
        "",
        "## Target files",
        "",
        `- \`${file}\``,
        "",
    ].join("\n");

function queue(labels: Record<number, string[]>): QueueIssue[] {
    return Object.entries(labels).map(([n, ls]) => ({
        number: Number(n),
        title: `issue ${n}`,
        labels: ls.map((name) => ({ name })),
        parent: null,
        assignees: [],
        updatedAt: CONFIG.now,
    }));
}

function port(labels: Record<number, string[]>): QueuePort {
    return {
        issuesWithOpenPr: [],
        priority: {},
        issueDetail(n: number): IssueDetail {
            return {
                state: "OPEN",
                stateReason: null,
                labels: labels[n] ?? ["ready-for-agent"],
                body: BODY(`src/f${n}.ts`),
            };
        },
        nativeBlockedBy: () => [],
    };
}

const TRUST = { owner: "owner", trustedAuthors: [] };
const OWNED = (ns: number[]) =>
    Object.fromEntries(ns.map((n) => [n, { author: "owner", readyBy: null }]));

describe("afk-dispatch plan (issue #5649)", () => {
    it("two dispatcher runs in sequence never dispatch the same issue", () => {
        // Run 1 sees two free slots and claims two issues.
        let labels: Record<number, string[]> = {
            1: ["ready-for-agent"],
            2: ["ready-for-agent"],
            3: ["ready-for-agent"],
        };
        const slots = { free: ["mbp", "hw"], online: ["mbp", "hw"] };
        const first = planDispatch(
            pick({
                issues: queue(labels),
                config: CONFIG,
                port: port(labels),
                trust: TRUST,
                provenance: OWNED([1, 2, 3]),
                claims: facts([], [], [], []),
            }),
            slots,
            () => null
        );
        const firstIssues = first.dispatch.map((d) => d.issue);
        expect(firstIssues).toHaveLength(2);

        // What run 1 left behind: claims, and the passes it dispatched.
        labels = { ...labels };
        for (const n of firstIssues)
            labels[n] = ["ready-for-agent", "in-progress"];
        const runs = firstIssues.map((n, i) =>
            passRun(i + 1, n, { status: "queued", conclusion: null })
        );
        const claimed = firstIssues;

        // Run 2 is triggered right after: it must not take run 1's issues.
        const second = planDispatch(
            pick({
                issues: queue(labels),
                config: CONFIG,
                port: port(labels),
                trust: TRUST,
                provenance: OWNED([1, 2, 3]),
                claims: facts(claimed, runs, [], []),
            }),
            slots,
            () => null
        );
        const secondIssues = second.dispatch.map((d) => d.issue);
        expect(secondIssues.filter((n) => firstIssues.includes(n))).toEqual([]);
        expect(second.release).toEqual([]);
    });

    it("resumes a dead pass first, pinned to its online host; caps at the slots", () => {
        const labels: Record<number, string[]> = {
            1: ["ready-for-agent"],
            2: ["ready-for-agent"],
            7: ["ready-for-agent", "in-progress", "model:opus"],
        };
        const picked = pick({
            issues: queue(labels),
            config: CONFIG,
            port: port(labels),
            trust: TRUST,
            provenance: OWNED([1, 2, 7]),
            claims: facts(
                [7],
                [passRun(1, 7, { conclusion: "failure" })],
                ["feat/issue-7"],
                []
            ),
        });
        const plan = planDispatch(
            picked,
            { free: ["mbp", "hw"], online: ["mbp", "hw"] },
            () => "hw"
        );
        expect(plan.dispatch[0]).toMatchObject({
            issue: 7,
            resume: true,
            host: "hw",
            model: "opus",
        });
        expect(plan.dispatch).toHaveLength(2);
        expect(plan.dispatch[1].resume).toBe(false);
    });

    it("a resume waits while its online host has no free slot, and goes anywhere once the host is offline", () => {
        const labels: Record<number, string[]> = {
            7: ["ready-for-agent", "in-progress"],
        };
        const picked = pick({
            issues: queue(labels),
            config: CONFIG,
            port: port(labels),
            trust: TRUST,
            provenance: OWNED([7]),
            claims: facts(
                [7],
                [passRun(1, 7, { conclusion: "failure" })],
                ["feat/issue-7"],
                []
            ),
        });
        const busy = planDispatch(
            picked,
            { free: ["mbp"], online: ["mbp", "hw"] },
            () => "hw"
        );
        expect(busy.dispatch).toEqual([]);
        expect(busy.waiting).toEqual([7]);
        const offline = planDispatch(
            picked,
            { free: ["mbp"], online: ["mbp"] },
            () => "hw"
        );
        expect(offline.dispatch[0]).toMatchObject({ issue: 7, host: null });
    });

    it("releases an orphan claim", () => {
        const labels: Record<number, string[]> = {
            7: ["ready-for-agent", "in-progress"],
        };
        const plan = planDispatch(
            pick({
                issues: queue(labels),
                config: CONFIG,
                port: port(labels),
                trust: TRUST,
                provenance: OWNED([7]),
                claims: facts([7], [passRun(1, 7)], [], []),
            }),
            { free: ["mbp"], online: ["mbp"] },
            () => null
        );
        expect(plan.release).toEqual([7]);
        expect(plan.dispatch).toEqual([]);
    });
});

describe("afk-dispatch repairs (issue #6795)", () => {
    const labels: Record<number, string[]> = {
        1: ["ready-for-agent"],
        2: ["ready-for-agent"],
        7: ["ready-for-agent", "in-progress"],
    };
    const repair = (number: number, pr: number) => ({
        number,
        pr,
        branch: `fix/issue-${number}`,
        model: "sonnet",
    });
    const picked = (claims: ReturnType<typeof facts>) =>
        pick({
            issues: queue(labels),
            config: CONFIG,
            port: port(labels),
            trust: TRUST,
            provenance: OWNED([1, 2, 7]),
            claims,
        });

    it("a land-failed repair takes a slot after the resumes and before the batch", () => {
        const plan = planDispatch(
            picked(
                facts(
                    [7],
                    [passRun(1, 7, { conclusion: "failure" })],
                    ["feat/issue-7"],
                    []
                )
            ),
            { free: ["mbp", "hw", "hw"], online: ["mbp", "hw"] },
            () => null,
            [repair(40, 400)]
        );
        expect(plan.dispatch.map((d) => d.issue)).toEqual([7, 40, 1]);
        expect(plan.dispatch[1]).toMatchObject({
            issue: 40,
            resume: true,
            host: null,
            pr: 400,
        });
    });

    it("repairs never exceed the free slots and never repeat a resume", () => {
        const plan = planDispatch(
            picked(
                facts(
                    [7],
                    [passRun(1, 7, { conclusion: "failure" })],
                    ["feat/issue-7"],
                    []
                )
            ),
            { free: ["mbp", "hw"], online: ["mbp", "hw"] },
            () => null,
            [repair(7, 70), repair(40, 400), repair(41, 410)]
        );
        expect(plan.dispatch.map((d) => d.issue)).toEqual([7, 40]);
    });

    it("two land-failed PRs naming one issue repair it once", () => {
        const plan = planDispatch(
            picked(facts([], [], [], [])),
            { free: ["mbp", "hw", "hw"], online: ["mbp", "hw"] },
            () => null,
            [repair(40, 400), repair(40, 401)]
        );
        expect(plan.dispatch.filter((d) => d.issue === 40)).toHaveLength(1);
    });

    it("a repair a finished pass already tried since the label is not dispatched again", () => {
        const runs = [passRun(1, 40, { createdAt: iso(30) })];
        expect(repairAttempted(runs, 40, iso(60))).toBe(true);
        expect(repairAttempted(runs, 40, iso(10))).toBe(false);
        expect(repairAttempted(runs, 40, null)).toBe(false);
        expect(repairAttempted(runs, 41, iso(60))).toBe(false);
    });

    it("an issue a live pass run holds is not a repair pick", () => {
        const live = livePassIssues([
            passRun(1, 40, { status: "in_progress", conclusion: null }),
            passRun(2, 41),
        ]);
        expect([...live]).toEqual([40]);
        const items = repairItems(
            [
                { number: 400, headRefName: "fix/issue-40" },
                { number: 410, headRefName: "fix/issue-41" },
            ],
            () => ({ labels: [], body: "" }),
            CONFIG,
            live
        );
        expect(items.map((r) => r.number)).toEqual([41]);
    });
});

describe("afk-dispatch inputs (issue #5649)", () => {
    it("parses a pass record and refuses a torn one", () => {
        const r = record({ usageLimitResetAt: iso(-10) });
        expect(parsePassRecord(JSON.stringify(r))).toEqual(r);
        expect(parsePassRecord("{")).toBeNull();
        expect(
            parsePassRecord(JSON.stringify({ ...r, version: 2 }))
        ).toBeNull();
        expect(
            parsePassRecord(JSON.stringify({ ...r, endedAt: "never" }))
        ).toBeNull();
    });

    it("reads TRUSTED_AUTHORS separated by commas, spaces or lines", () => {
        expect(parseTrustedAuthors("a, @b\nc  d")).toEqual([
            "a",
            "b",
            "c",
            "d",
        ]);
        expect(parseTrustedAuthors(undefined)).toEqual([]);
    });

    it("the workflow's run name carries the acknowledgement the streak reads", () => {
        const wf = parse(
            readFileSync(
                join(
                    __dirname,
                    "..",
                    "..",
                    ".github",
                    "workflows",
                    "afk-dispatch.yml"
                ),
                "utf8"
            )
        ) as {
            "run-name": string;
            on: { workflow_dispatch: { inputs: object } };
        };
        expect(wf["run-name"]).toContain(ACK_MARKER);
        expect(wf["run-name"]).toContain("inputs.ack_failures");
        expect(Object.keys(wf.on.workflow_dispatch.inputs)).toContain(
            "ack_failures"
        );
    });
});

describe("a dead pass's claim from real-shaped run titles (issue #6194)", () => {
    // The titles the YAML-parsed run-name renders (the structure guard pins
    // that), not hand-built ones: bare `afk-pass` maps to nothing.
    const dead = (issue: number) =>
        run(10, `afk-pass #${issue}`, { conclusion: "failure" });

    it("no branch → release, pushed branch → resume", () => {
        const [orphan, pushed] = facts(
            [7, 8],
            [dead(7), { ...dead(8), id: 11 }],
            ["fix/issue-8"],
            []
        );
        expect(claimFate(orphan)).toBe("release");
        expect(claimFate(pushed)).toBe("resume");
    });

    it("a bare-titled run proves nothing, so the claim reads as live (the bug)", () => {
        const [f] = facts(
            [7],
            [run(10, "afk-pass", { conclusion: "failure" })],
            [],
            []
        );
        expect(claimFate(f)).toBe("live");
    });

    it("a resume run's title still names its issue", () => {
        const [f] = facts(
            [7],
            [run(10, "afk-pass #7 (resume)", { conclusion: "failure" })],
            [],
            []
        );
        expect(claimFate(f)).toBe("release");
    });
});

describe("orphan claims under a hold (issue #6194)", () => {
    const orphanFacts = facts(
        [7, 8, 9],
        [
            run(10, "afk-pass #7", { conclusion: "failure" }),
            run(11, "afk-pass #8", { conclusion: "failure" }),
        ],
        ["fix/issue-8"],
        []
    );
    const holds = [
        { kind: "failure-streak", message: "m", notify: false },
        { kind: "red", message: "m" },
        { kind: "no-budget", message: "m" },
        { kind: "usage-limit", message: "m", until: "x" },
    ] as const;

    it("releases the orphan, not the resumable nor the foreign claim", () => {
        for (const h of holds)
            expect(holdReleases(h, orphanFacts)).toEqual([7]);
    });

    it("the kill switch releases nothing", () => {
        expect(
            holdReleases({ kind: "disabled", message: "m" }, orphanFacts)
        ).toEqual([]);
    });
});

describe("admission by queue depth (issue #6988)", () => {
    const LIMITS = { queueMax: 6, failedMax: 4 };
    const labels: Record<number, string[]> = {
        1: ["ready-for-agent"],
        2: ["ready-for-agent"],
        7: ["ready-for-agent", "in-progress"],
    };
    // A dead pass's pushed claim (#7) and two fresh picks (#1, #2).
    const picked = pick({
        issues: queue(labels),
        config: CONFIG,
        port: port(labels),
        trust: TRUST,
        provenance: OWNED([1, 2, 7]),
        claims: facts(
            [7],
            [passRun(1, 7, { conclusion: "failure" })],
            ["feat/issue-7"],
            []
        ),
    });
    const SLOTS = { free: ["mbp", "hw", "hw", "hw"], online: ["mbp", "hw"] };
    const REPAIR = {
        number: 40,
        pr: 400,
        branch: "fix/issue-40",
        model: "sonnet",
    };
    const rows = (ready: number, failed: number) => [
        ...Array.from({ length: ready }, (_, i) => ({
            headRefName: `feat/issue-${100 + i}`,
            labels: [{ name: "ready-to-land" }, { name: "queue:held" }],
        })),
        ...Array.from({ length: failed }, (_, i) => ({
            headRefName: `feat/issue-${200 + i}`,
            // A stale ready-to-land beside land-failed counts as failed.
            labels: [{ name: "ready-to-land" }, { name: "land-failed" }],
        })),
        { headRefName: "feat/issue-300", labels: [] },
    ];
    const plan = (ready: number, failed: number) =>
        planDispatch(
            picked,
            SLOTS,
            () => null,
            [REPAIR],
            queueAdmission(queueDepth(rows(ready, failed)), LIMITS)
        );

    it("counts ready-to-land and land-failed PRs from the pr list", () => {
        expect(queueDepth(rows(6, 3))).toEqual({ ready: 6, failed: 3 });
    });

    it("6 ready-to-land at queueMax 6: no new pick; the resume and the repair still run", () => {
        const p = plan(6, 0);
        expect(p.dispatch.map((d) => d.issue)).toEqual([7, 40]);
        expect(p.held).toEqual([1, 2]);
        expect(queueAdmission({ ready: 6, failed: 0 }, LIMITS)).toEqual({
            kind: "queue",
            message: "queue 6 ≥ 6 — no new pick",
        });
    });

    it("4 land-failed at failedMax 4: repairs only", () => {
        const p = plan(0, 4);
        expect(p.dispatch.map((d) => d.issue)).toEqual([40]);
        expect(p.held).toEqual([7, 1, 2]);
        expect(queueAdmission({ ready: 0, failed: 4 }, LIMITS).kind).toBe(
            "failed"
        );
    });

    it("a resume held under failedMax is still repaired when its PR is land-failed", () => {
        const p = planDispatch(
            picked,
            SLOTS,
            () => null,
            [{ ...REPAIR, number: 7, pr: 70 }],
            queueAdmission({ ready: 0, failed: 4 }, LIMITS)
        );
        expect(p.dispatch).toEqual([
            { issue: 7, model: "sonnet", resume: true, host: null, pr: 70 },
        ]);
        expect(p.held).toEqual([1, 2]);
    });

    it("both limits crossed: failedMax wins, repairs only", () => {
        expect(plan(6, 4).dispatch.map((d) => d.issue)).toEqual([40]);
    });

    it("5 ready-to-land and 3 land-failed: picks as today", () => {
        const p = plan(5, 3);
        expect(p.dispatch.map((d) => d.issue)).toEqual([7, 40, 1, 2]);
        expect(p.held).toEqual([]);
        expect(p).toEqual(planDispatch(picked, SLOTS, () => null, [REPAIR]));
    });

    it("the limits are config, with the measured defaults", () => {
        expect(parseAfkDispatchConfig({})).toMatchObject(LIMITS);
        expect(
            parseAfkDispatchConfig({
                afkDispatch: { queueMax: 9, failedMax: 2 },
            })
        ).toMatchObject({ queueMax: 9, failedMax: 2 });
        const repo = JSON.parse(
            readFileSync(join(__dirname, "../../tolaria.config.json"), "utf8")
        );
        expect(parseAfkDispatchConfig(repo)).toMatchObject(LIMITS);
    });
});

describe("repairs under a hold (issue #6652)", () => {
    const red = { sha: "a".repeat(40), failedStep: "test:app" } as never;
    const repairs = [
        { number: 11, pr: 111, branch: "feat/issue-11", model: "sonnet" },
        { number: 12, pr: 112, branch: "fix/issue-12", model: "opus" },
    ];

    const admits = (over: Parameters<typeof holdInput>[0]) => {
        const h = holdFor(holdInput(over));
        return h
            ? holdAdmitsRepairs(h, holdFor(holdInput({ ...over, red: null })))
            : null;
    };

    it("only a RED that is the sole hold admits repairs; every other hold stands", () => {
        expect([
            admits({ red }),
            admits({ healthError: "502" }),
            admits({ dispatcherActive: false }),
            admits({ budget: { budget: 0, maxPct: 80, hours: 5 } }),
            admits({
                red,
                reading: { weighted: 8000, pct: 80, remote: 0 },
            }),
            admits({ red, usageLimitResetAt: "2026-10-27T20:00:00Z" }),
        ]).toEqual([true, false, false, false, false, false]);
    });

    it("plans the repairs, one slot each, and no new issue or resume", () => {
        const plan = planRepairsUnderHold(
            { free: ["mbp", "hw"], online: ["mbp", "hw"] },
            repairs
        );
        expect(plan.dispatch).toEqual([
            { issue: 11, model: "sonnet", resume: true, host: null, pr: 111 },
            { issue: 12, model: "opus", resume: true, host: null, pr: 112 },
        ]);
        expect(plan.release).toEqual([]);
        expect(plan.held).toEqual([]);
    });

    it("never more repairs than free slots", () => {
        const plan = planRepairsUnderHold(
            { free: ["mbp"], online: ["mbp"] },
            repairs
        );
        expect(plan.dispatch.map((d) => d.issue)).toEqual([11]);
    });
});
