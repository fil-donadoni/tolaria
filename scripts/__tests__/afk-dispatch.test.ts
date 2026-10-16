import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
    ACK_MARKER,
    budgetReading,
    claimFacts,
    failureStreak,
    holdFor,
    hostOfRunnerName,
    mayClaim,
    parsePassRecord,
    parseTrustedAuthors,
    passRunIssue,
    passSlots,
    planDispatch,
    usageLimitResetAt,
    type FailureStreak,
    type HoldInput,
    type PassRecord,
    type RunnerRow,
    type WorkflowRun,
} from "../lib/afk-dispatch";
import { pick } from "../lib/picker";
import type {
    IssueDetail,
    PlanConfig,
    QueueIssue,
    QueuePort,
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

const NO_STREAK: FailureStreak = { runs: [], notify: false };

function holdInput(over: Partial<HoldInput> = {}): HoldInput {
    return {
        passWorkflowActive: true,
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
        });
        const s = failureStreak(runs, [emailed]);
        expect(s.runs).toHaveLength(3);
        expect(s.notify).toBe(false);
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

describe("afk-dispatch claim facts (issue #5649)", () => {
    const pr = (issue: number, labels: string[] = []) => ({
        number: 9000 + issue,
        headRefName: `feat/issue-${issue}`,
        labels,
    });

    it("a claim with no afk-pass run at all belongs to a session outside the pipeline: held", () => {
        const [f] = claimFacts([7], [], [], []);
        expect(f.liveRun).toBe(true);
    });

    it("a claim with a running pass is held", () => {
        const [f] = claimFacts(
            [7],
            [passRun(1, 7, { status: "in_progress", conclusion: null })],
            [],
            []
        );
        expect(f.liveRun).toBe(true);
    });

    it("a claim whose PR waits in the queue is held; a land-failed PR is a dead pass's work", () => {
        const runs = [passRun(1, 7), passRun(2, 8)];
        const [queued, failed] = claimFacts(
            [7, 8],
            runs,
            [],
            [pr(7, ["ready-to-land"]), pr(8, ["land-failed"])]
        );
        expect(queued.liveRun).toBe(true);
        expect(failed).toEqual({
            issue: 8,
            liveRun: false,
            branchPushed: true,
            pr: 9008,
        });
    });

    it("a dead pass with a pushed branch resumes; with none it is an orphan", () => {
        const runs = [passRun(1, 7, { conclusion: "failure" }), passRun(2, 8)];
        const [pushed, orphan] = claimFacts(
            [7, 8],
            runs,
            ["fix/issue-7", "main"],
            []
        );
        expect(pushed).toMatchObject({ liveRun: false, branchPushed: true });
        expect(orphan).toMatchObject({ liveRun: false, branchPushed: false });
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
                claims: claimFacts([], [], [], []),
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
                claims: claimFacts(claimed, runs, [], []),
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
            claims: claimFacts(
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
            claims: claimFacts(
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
                claims: claimFacts([7], [passRun(1, 7)], [], []),
            }),
            { free: ["mbp"], online: ["mbp"] },
            () => null
        );
        expect(plan.release).toEqual([7]);
        expect(plan.dispatch).toEqual([]);
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
