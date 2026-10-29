import { describe, it, expect } from "vitest";
import {
    classifyOrphanWorktree,
    cwdInside,
    orphanWorktrees,
    parseLsofCwds,
    renderHeldOrphanLines,
    type OrphanWorktreeFacts,
} from "../lib/orphan-worktree";
import { isAdoptableWorktree } from "../lib/issue-worktree";
import { orphanPlanParts, resumeItems } from "../lib/queue-plan";
import type { PlanConfig, QueueIssue } from "../lib/queue-plan";
import type { ClaimOwner } from "../lib/claim-verdict";

/**
 * Orphaned issue worktrees (issue #5531): an unclaimed issue whose worktree
 * holds unpushed commits is adopted only on POSITIVE evidence of no owner.
 */
const PROVEN: OrphanWorktreeFacts = {
    issue: 5287,
    path: "/w/tolaria-issue-5287",
    unpushedCommits: 1,
    ownerRecorded: false,
    ownerAlive: null,
    processInside: false,
    quietMinutes: 600,
};

describe("classifyOrphanWorktree (issue #5531)", () => {
    it("adopts: unpushed commit, no owner ever recorded, nothing inside, quiet", () => {
        expect(classifyOrphanWorktree(PROVEN).state).toBe("adopt");
    });

    it("adopts a provably dead recorded owner", () => {
        expect(
            classifyOrphanWorktree({
                ...PROVEN,
                ownerRecorded: true,
                ownerAlive: false,
            }).state
        ).toBe("adopt");
    });

    it("zero unpushed commits is not an orphan — a fresh pick may reuse it", () => {
        expect(
            classifyOrphanWorktree({ ...PROVEN, unpushedCommits: 0 }).state
        ).toBe("none");
    });

    it("a live process with its cwd inside holds it, naming the worktree", () => {
        const v = classifyOrphanWorktree({ ...PROVEN, processInside: true });
        expect(v.state).toBe("held");
        expect(v.reason).toContain(PROVEN.path);
    });

    it("a live recorded owner holds it", () => {
        expect(
            classifyOrphanWorktree({
                ...PROVEN,
                ownerRecorded: true,
                ownerAlive: true,
            }).state
        ).toBe("held");
    });

    it.each([
        ["unpushed count", { unpushedCommits: null }],
        ["process list", { processInside: null }],
        ["quiescence", { quietMinutes: null }],
        ["recorded owner liveness", { ownerRecorded: true, ownerAlive: null }],
    ] as [string, Partial<OrphanWorktreeFacts>][])(
        "unknown %s holds it — never adopted, never picked fresh",
        (_, patch) => {
            expect(classifyOrphanWorktree({ ...PROVEN, ...patch }).state).toBe(
                "held"
            );
        }
    );

    it("a worktree changed inside the quiet window holds it", () => {
        expect(
            classifyOrphanWorktree({ ...PROVEN, quietMinutes: 5 }).state
        ).toBe("held");
    });
});

describe("orphanWorktrees census (issue #5531)", () => {
    const porcelain = [
        "worktree /w/tolaria",
        "branch refs/heads/staging",
        "",
        "worktree /w/tolaria-issue-5287",
        "branch refs/heads/feat/issue-5287",
        "",
        "worktree /w/tolaria-issue-9",
        "branch refs/heads/fix/issue-9",
        "",
        "worktree /w/tolaria-docs",
        "branch refs/heads/docs/issue-5287-notes",
        "",
    ].join("\n");
    const runner = (_cmd: string, args: string[]): string => {
        if (args[0] === "worktree") return porcelain;
        if (args[0] === "for-each-ref") return "";
        // rev-list --count <branch> --not <base>
        return args[2] === "fix/issue-9" ? "0" : "3";
    };
    const base = {
        baseRef: "origin/staging",
        owners: new Map<number, ClaimOwner>(),
        now: 0,
        runner,
        cwdProbe: () => false,
        quiet: () => 600,
    };

    it("finds the unclaimed issue's worktree; skips zero-commit and non-issue ones", () => {
        const found = orphanWorktrees(new Set([5287, 9]), base);
        expect(found.map((o) => [o.issue, o.verdict.state])).toEqual([
            [5287, "adopt"],
        ]);
    });

    it("ignores a worktree whose issue is claimed (not in the unclaimed set)", () => {
        expect(orphanWorktrees(new Set([9]), base)).toEqual([]);
    });

    it("an unreadable process list holds it", () => {
        const found = orphanWorktrees(new Set([5287]), {
            ...base,
            cwdProbe: () => null,
        });
        expect(found[0].verdict.state).toBe("held");
    });

    it("an unreadable worktree list is [] — pre-#5531 behaviour, never an adoption", () => {
        expect(
            orphanWorktrees(new Set([5287]), {
                ...base,
                runner: () => {
                    throw new Error("git failed");
                },
            })
        ).toEqual([]);
    });
});

describe("orphan worktrees in the plan (issue #5531)", () => {
    const config = {
        batchCap: 3,
        staleClaimHours: 24,
        defaultImplModel: "sonnet",
        now: "2026-10-12T00:00:00Z",
    } as PlanConfig;
    const issue = (number: number): QueueIssue => ({
        number,
        title: "",
        labels: [{ name: "ready-for-agent" }],
        parent: null,
        assignees: [],
        updatedAt: "",
    });
    const orphans = [
        {
            issue: 1,
            path: "/w/1",
            branch: "feat/issue-1",
            verdict: { state: "adopt" as const, reason: "ok" },
        },
        {
            issue: 2,
            path: "/w/2",
            branch: "fix/issue-2",
            verdict: { state: "held" as const, reason: "worktree /w/2 held" },
        },
    ];

    it("keeps both out of batch; adopt → recoverable resume, held → skipped naming the worktree", () => {
        const parts = orphanPlanParts(orphans);
        expect([...parts.excluded].sort()).toEqual([1, 2]);
        expect(
            resumeItems(parts.classified, [issue(1), issue(2)], config)
        ).toEqual([
            { number: 1, pr: null, state: "recoverable", model: "sonnet" },
        ]);
        expect(parts.skipped).toEqual([
            {
                number: 2,
                reason: "worktree /w/2 held",
                action: "held-worktree",
            },
        ]);
    });
});

describe("helpers (issue #5531)", () => {
    it("wt:new --resume adopts only the issue's own feat|fix branch", () => {
        expect(isAdoptableWorktree(5287, "feat/issue-5287")).toBe(true);
        expect(isAdoptableWorktree(5287, "fix/issue-5287")).toBe(true);
        expect(isAdoptableWorktree(5287, "fix/issue-528")).toBe(false);
        expect(isAdoptableWorktree(5287, "docs/issue-5287")).toBe(false);
        expect(isAdoptableWorktree(5287, null)).toBe(false);
    });

    it("cwdInside matches the dir and its children, never a sibling prefix", () => {
        expect(cwdInside("/w/a", "/w/a")).toBe(true);
        expect(cwdInside("/w/a/src", "/w/a")).toBe(true);
        expect(cwdInside("/w/ab", "/w/a")).toBe(false);
    });

    it("parseLsofCwds pairs each pid with its cwd", () => {
        expect(parseLsofCwds("p10\nn/w/a\np11\nn/w/b/c\n")).toEqual([
            { pid: 10, cwd: "/w/a" },
            { pid: 11, cwd: "/w/b/c" },
        ]);
    });

    it("renders only held worktrees", () => {
        expect(renderHeldOrphanLines([])).toEqual([]);
        const lines = renderHeldOrphanLines([
            {
                issue: 2,
                path: "/w/2",
                branch: "fix/issue-2",
                verdict: { state: "held", reason: "why" },
            },
        ]);
        expect(lines.join("\n")).toContain("#2");
    });
});
