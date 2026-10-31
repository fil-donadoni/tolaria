import { describe, expect, it } from "vitest";
import {
    declaredRepairAmong,
    MAX_COMMITS_SINCE_RED,
    repairProofCommands,
    repairProofNote,
    repairProofPlan,
    runRepairProof,
    tipMergesDeclaredRepair,
    type RepairProofPlan,
} from "../lib/health-repair-proof";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";
import {
    decodeStatus,
    DESCRIPTION_MAX,
    encodeDescription,
    HOSTED_MACHINE_PREFIX,
    isRepairProofGreen,
    REPAIR_PROOF_MARK,
} from "../lib/health-verdict-store";

/**
 * A declared repair's tip is GREEN on the RED's own evidence (issue #7657,
 * ADR 0156 Amendment V): the step selection is a pure function of the RED's
 * record, the proof runs it in the flake path's order, and the GREEN it
 * writes is marked so the batch gate and `release` still gate the tip whole.
 */
const OFFLINE = splitHealthGates(HEALTH_SCRIPTS).offline;
const AFTER_TEST = OFFLINE.slice(OFFLINE.indexOf("test") + 1);
const STEPS_BEFORE_TEST = OFFLINE.filter(
    (s) => s !== "worktree:init" && s !== "test"
);

const proofOf = (plan: RepairProofPlan) => {
    if (plan.kind !== "proof") throw new Error(`not a proof: ${plan.reason}`);
    return plan;
};

describe("repairProofPlan — the RED's record decides what the repair tip owes (issue #7657)", () => {
    it("RED at `test` in test:app → the failing files + test:bot, test:blade + every step after `test`", () => {
        // `test` is the last offline step today; a step after it would be
        // owed too — pinned with a synthetic order below.
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        tests: ["scripts/__tests__/x.test.ts"],
                        machine: "macbook",
                    },
                ],
                offline: OFFLINE,
                corpusTests: [],
            })
        );
        expect(plan).toEqual({
            kind: "proof",
            files: ["scripts/__tests__/x.test.ts"],
            step: "test",
            unreached: ["test:bot", "test:blade", ...AFTER_TEST],
            corpus: false,
        });
    });

    it("RED at step 3 of 8 (a synthetic order) → files + steps 4–8, in the run's order", () => {
        const offline = [
            "worktree:init",
            "check:all",
            "test",
            "check:gaps",
            "check:targets",
            "check:x",
            "check:y",
            "check:z",
        ];
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "a".repeat(40),
                        step: "test (retry: bot-node, assertion)",
                        tests: ["convex/gre/__tests__/a.bot.test.ts"],
                    },
                ],
                offline,
                corpusTests: [],
            })
        );
        // A retry note is stripped; files in test:bot leave only test:blade
        // of the chain unreached.
        expect(plan.step).toBe("test");
        expect(plan.unreached).toEqual([
            "test:blade",
            "check:gaps",
            "check:targets",
            "check:x",
            "check:y",
            "check:z",
        ]);
    });

    it("RED at the last step, last tier → the files only", () => {
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        evidenceFiles: [
                            "convex/gre/ai/blade/__tests__/blade.shard-2.spec.ts",
                        ],
                    },
                ],
                offline: ["worktree:init", "check:all", "test"],
                corpusTests: [],
            })
        );
        expect(plan.unreached).toEqual([]);
        expect(plan.files).toEqual([
            "convex/gre/ai/blade/__tests__/blade.shard-2.spec.ts",
        ]);
    });

    it("a RED with no failing test file (a step failure) → the full gate, fail closed", () => {
        const plan = repairProofPlan({
            reds: [{ sha: "a".repeat(40), step: "check:all" }],
            offline: OFFLINE,
            corpusTests: [],
        });
        expect(plan.kind).toBe("full");
        expect((plan as { reason: string }).reason).toMatch(
            /names no failing test file \(a step failure\)/
        );
    });

    it("a RED at a step the run does not know, or with no step, → the full gate", () => {
        for (const step of [undefined, "derive:sync", "worktree:init"])
            expect(
                repairProofPlan({
                    reds: [{ sha: "a".repeat(40), step, tests: ["x.test.ts"] }],
                    offline: OFFLINE,
                    corpusTests: [],
                }).kind
            ).toBe("full");
        expect(
            repairProofPlan({ reds: [], offline: OFFLINE, corpusTests: [] })
        ).toEqual({ kind: "full", reason: "no RED stands" });
    });

    it("the evidence's files win over the description's cut list", () => {
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        tests: ["a.test.ts"],
                        evidenceFiles: ["a.test.ts", "b.test.ts", "c.test.ts"],
                    },
                ],
                offline: OFFLINE,
                corpusTests: [],
            })
        );
        expect(plan.files).toEqual(["a.test.ts", "b.test.ts", "c.test.ts"]);
    });

    it("stacked REDs (issue #7139): the files are the union, the unreached steps the union in the run's order, the earliest step names the run", () => {
        const offline = ["worktree:init", "check:all", "test", "check:gaps"];
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "b".repeat(40),
                        step: "test",
                        tests: [
                            "convex/gre/ai/blade/__tests__/blade.shard-0.spec.ts",
                        ],
                    },
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        tests: ["scripts/__tests__/z.test.ts"],
                    },
                ],
                offline,
                corpusTests: [],
            })
        );
        expect(plan.files).toEqual([
            "convex/gre/ai/blade/__tests__/blade.shard-0.spec.ts",
            "scripts/__tests__/z.test.ts",
        ]);
        expect(plan.unreached).toEqual([
            "test:bot",
            "test:blade",
            "check:gaps",
        ]);
        // One RED a step failure → the whole plan is the full gate.
        expect(
            repairProofPlan({
                reds: [
                    { sha: "b".repeat(40), step: "check:all" },
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        tests: ["scripts/__tests__/z.test.ts"],
                    },
                ],
                offline,
                corpusTests: [],
            }).kind
        ).toBe("full");
    });

    it("a RED a GitHub-hosted run wrote skipped the corpus tests: they join the files", () => {
        const red = {
            sha: "a".repeat(40),
            step: "test",
            tests: ["scripts/__tests__/x.test.ts"],
        };
        const corpusTests = ["convex/gre/ai/__tests__/corpus.bot.test.ts"];
        const hosted = proofOf(
            repairProofPlan({
                reds: [{ ...red, machine: `${HOSTED_MACHINE_PREFIX}runner` }],
                offline: OFFLINE,
                corpusTests,
            })
        );
        expect(hosted.corpus).toBe(true);
        expect(hosted.files).toEqual([
            "convex/gre/ai/__tests__/corpus.bot.test.ts",
            "scripts/__tests__/x.test.ts",
        ]);
        const own = proofOf(
            repairProofPlan({
                reds: [{ ...red, machine: "macbook" }],
                offline: OFFLINE,
                corpusTests,
            })
        );
        expect(own.corpus).toBe(false);
        expect(own.files).toEqual(["scripts/__tests__/x.test.ts"]);
    });

    it("steps the RED's run passed are not in the plan", () => {
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    { sha: "a".repeat(40), step: "test", tests: ["x.test.ts"] },
                ],
                offline: OFFLINE,
                corpusTests: [],
            })
        );
        for (const passed of STEPS_BEFORE_TEST)
            expect(plan.unreached).not.toContain(passed);
        expect(plan.unreached).not.toContain("test:app");
        expect(plan.unreached).not.toContain("worktree:init");
    });
});

describe("repairProofNote — the GREEN's description (issue #7657)", () => {
    const base = {
        kind: "proof" as const,
        files: ["x.test.ts"],
        step: "test",
        corpus: false,
    };
    it("names the failing files and the unreached steps, the mark first", () => {
        expect(repairProofNote({ ...base, unreached: ["test:bot", "a"] })).toBe(
            `${REPAIR_PROOF_MARK}failing files + 2 unreached steps green`
        );
        expect(repairProofNote({ ...base, unreached: ["test:bot"] })).toBe(
            `${REPAIR_PROOF_MARK}failing files + 1 unreached step green`
        );
        expect(repairProofNote({ ...base, unreached: [] })).toBe(
            `${REPAIR_PROOF_MARK}failing files green`
        );
        expect(
            repairProofNote({ ...base, corpus: true, unreached: ["a"] })
        ).toBe(
            `${REPAIR_PROOF_MARK}failing files + corpus tests + 1 unreached step green`
        );
    });

    it("rides the commit status whole, and reads back as a repair-proof GREEN — a full GREEN or a flake GREEN does not", () => {
        const step = repairProofNote({
            ...base,
            corpus: true,
            unreached: ["test:bot", "test:blade", "check:gaps"],
        });
        const sha = "c".repeat(40);
        const description = encodeDescription({
            sha,
            status: "green",
            step,
            machine: "github-hosted/some-runner-1234",
        });
        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        const back = decodeStatus({
            sha,
            state: "success",
            description,
            targetUrl: null,
            createdAt: null,
        });
        expect(back?.step).toBe(step);
        expect(isRepairProofGreen(back)).toBe(true);
        expect(isRepairProofGreen({ status: "green" })).toBe(false);
        expect(
            isRepairProofGreen({
                status: "green",
                step: "flake: test passed on a fresh run",
            })
        ).toBe(false);
        expect(isRepairProofGreen({ status: "red", step })).toBe(false);
        expect(isRepairProofGreen(null)).toBe(false);
    });
});

describe("runRepairProof — the flake path's order on the repair tip (issue #7657)", () => {
    const plan = {
        kind: "proof" as const,
        files: [
            "scripts/__tests__/x.test.ts",
            "convex/gre/ai/blade/__tests__/blade.shard-1.spec.ts",
        ],
        step: "test",
        unreached: ["test:bot", "check:gaps"],
        corpus: false,
    };

    it("runs the files (default config and blade apart, exact paths), then each unreached step; all green is green", async () => {
        const ran: string[] = [];
        const out = await runRepairProof(plan, {
            note: () => {},
            runFiles: (cmds) => {
                ran.push(...cmds.map((c) => c.args.join(" ")));
                return true;
            },
            runStep: (step) => {
                ran.push(`step ${step}`);
                return true;
            },
        });
        expect(out).toEqual({ outcome: "green" });
        expect(ran).toEqual([
            "vitest run scripts/__tests__/x.test.ts",
            "vitest run --config vitest.blade.config.ts convex/gre/ai/blade/__tests__/blade.shard-1.spec.ts",
            "step test:bot",
            "step check:gaps",
        ]);
        expect(repairProofCommands(plan).map((c) => c.env)).toEqual([
            {},
            { BLADE_TIER: "must" },
        ]);
    });

    it("a failing file is RED at the RED's step, and no unreached step runs", async () => {
        const steps: string[] = [];
        const out = await runRepairProof(plan, {
            note: () => {},
            runFiles: () => false,
            runStep: (s) => {
                steps.push(s);
                return true;
            },
        });
        expect(out).toEqual({ outcome: "red", step: "test" });
        expect(steps).toEqual([]);
    });

    it("a failing unreached step is RED at that step, the ones after it not run", async () => {
        const steps: string[] = [];
        const out = await runRepairProof(plan, {
            note: () => {},
            runFiles: async () => true,
            runStep: async (s) => {
                steps.push(s);
                return s !== "test:bot";
            },
        });
        expect(out).toEqual({ outcome: "red", step: "test:bot" });
        expect(steps).toEqual(["test:bot"]);
    });

    it("no file left (a revert dropped them all) runs the unreached steps alone", async () => {
        let files = 0;
        const out = await runRepairProof(
            { ...plan, files: [] },
            {
                note: () => {},
                runFiles: () => {
                    files += 1;
                    return true;
                },
                runStep: () => true,
            }
        );
        expect(out).toEqual({ outcome: "green" });
        expect(files).toBe(0);
    });
});

describe("declaredRepairAmong — the commit since the RED that merges a declared repair (issue #7657)", () => {
    const commits = [
        { sha: "d".repeat(40), pr: null },
        { sha: "c".repeat(40), pr: 42 },
        { sha: "b".repeat(40), pr: 41 },
    ];
    const closedBy = (sha: string) =>
        sha === "c".repeat(40) ? [7, 9] : sha === "b".repeat(40) ? [3] : [];

    it("names the PR commit whose PR closes a repair issue; a direct commit (derive:sync) never", () => {
        expect(
            declaredRepairAmong({ commits, repairIssues: [7], closedBy })
        ).toEqual({ sha: "c".repeat(40), pr: 42 });
        expect(
            declaredRepairAmong({ commits, repairIssues: [3], closedBy })
        ).toEqual({ sha: "b".repeat(40), pr: 41 });
    });

    it("null with no repair declared, with no closing PR, or past the run's cap", () => {
        expect(
            declaredRepairAmong({ commits, repairIssues: [], closedBy })
        ).toBeNull();
        expect(
            declaredRepairAmong({ commits, repairIssues: [99], closedBy })
        ).toBeNull();
        const long = Array.from(
            { length: MAX_COMMITS_SINCE_RED + 1 },
            (_, i) => ({
                sha: String(i).padStart(40, "0"),
                pr: 42,
            })
        );
        expect(
            declaredRepairAmong({
                commits: long,
                repairIssues: [7],
                closedBy: () => [7],
            })
        ).toBeNull();
    });
});

describe("tipMergesDeclaredRepair — total: an unreadable fact is the full gate (issue #7657)", () => {
    const red = "a".repeat(40);
    const tip = "c".repeat(40);

    it("answers through the injected seams", () => {
        const warned: string[] = [];
        expect(
            tipMergesDeclaredRepair("/nowhere", red, tip, {
                repairIssues: () => [7],
                commits: () => [{ sha: tip, pr: 42 }],
                closedBy: () => [7],
                warn: (l) => warned.push(l),
            })
        ).toEqual({ sha: tip, pr: 42 });
        expect(warned).toEqual([]);
    });

    it("a tip that does not descend from the RED, or no repair declared, is none — no gh read at all", () => {
        let reads = 0;
        expect(
            tipMergesDeclaredRepair("/nowhere", red, tip, {
                repairIssues: () => [7],
                commits: () => null,
                closedBy: () => {
                    reads += 1;
                    return [7];
                },
            })
        ).toBeNull();
        expect(
            tipMergesDeclaredRepair("/nowhere", red, tip, {
                repairIssues: () => [],
                commits: () => {
                    reads += 1;
                    return [{ sha: tip, pr: 42 }];
                },
                closedBy: () => [7],
            })
        ).toBeNull();
        expect(reads).toBe(0);
    });

    it("a read that throws answers null and says so", () => {
        const warned: string[] = [];
        expect(
            tipMergesDeclaredRepair("/nowhere", red, tip, {
                repairIssues: () => {
                    throw new Error("pivot down");
                },
                warn: (l) => warned.push(l),
            })
        ).toBeNull();
        expect(warned).toEqual([
            "the repair tip could not be recognised — pivot down",
        ]);
    });
});
