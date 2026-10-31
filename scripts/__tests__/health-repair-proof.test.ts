import { describe, expect, it } from "vitest";
import {
    declaredRepairAmong,
    MAX_PR_COMMITS_SINCE_RED,
    redStepOf,
    repairProofCommands,
    repairProofNote,
    repairProofPlan,
    repairProofProjectCommands,
    resolveMovedFiles,
    runRepairProof,
    tipMergesDeclaredRepair,
    type ProofPlan,
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
const NO_CORPUS = () => [];

const proofOf = (plan: RepairProofPlan): ProofPlan => {
    if (plan.kind !== "proof") throw new Error(`not a proof: ${plan.reason}`);
    return plan;
};
const reasonOf = (plan: RepairProofPlan): string =>
    plan.kind === "full" ? plan.reason : "";

/** A published evidence body's header lines (`buildEvidence`). */
const evidenceOf = (
    files: readonly string[],
    opts: { projects?: readonly string[]; failLines?: readonly string[] } = {}
) =>
    [
        "<!-- tolaria-health-evidence sha=aaaa -->",
        "## Health RED · `aaaa` · test",
        "",
        `- **projects:** ${(opts.projects ?? []).join(", ") || "none named"}`,
        `- **files:** ${files.map((f) => `\`${f}\``).join(", ")}`,
        "",
        "### Failures",
        "",
        ...(opts.failLines ?? []),
    ].join("\n");

describe("repairProofPlan — the RED's record decides what the repair tip owes (issue #7657)", () => {
    it("RED at `test` in test:app → the failing files + test:bot, test:blade + every step after `test`", () => {
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
                corpusTests: NO_CORPUS,
            })
        );
        expect(plan).toEqual({
            kind: "proof",
            files: ["scripts/__tests__/x.test.ts"],
            tests: [{ file: "scripts/__tests__/x.test.ts" }],
            // No evidence, a `scripts/` non-Bot file: no shared-worker
            // project decided by path.
            projects: [],
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
                corpusTests: NO_CORPUS,
            })
        );
        // A retry note is stripped; files in test:bot leave only test:blade
        // of the chain unreached; a Bot file ran in `bot-node`, re-run whole.
        expect(plan.step).toBe("test");
        expect(plan.projects).toEqual(["bot-node"]);
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
        const file = "convex/gre/ai/blade/__tests__/blade.shard-2.spec.ts";
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        evidence: evidenceOf([file]),
                    },
                ],
                offline: ["worktree:init", "check:all", "test"],
                corpusTests: NO_CORPUS,
            })
        );
        expect(plan.unreached).toEqual([]);
        expect(plan.files).toEqual([file]);
        expect(plan.projects).toEqual([]);
    });

    it("a RED with no failing test file (a step failure) → the full gate, fail closed", () => {
        const plan = repairProofPlan({
            reds: [{ sha: "a".repeat(40), step: "check:all" }],
            offline: OFFLINE,
            corpusTests: NO_CORPUS,
        });
        expect(plan.kind).toBe("full");
        expect(reasonOf(plan)).toMatch(
            /names no failing test file \(a step failure\)/
        );
    });

    it("a RED at a step the run does not know, or with no step, → the full gate", () => {
        for (const step of [undefined, "derive:sync", "worktree:init"])
            expect(
                repairProofPlan({
                    reds: [{ sha: "a".repeat(40), step, tests: ["x.test.ts"] }],
                    offline: OFFLINE,
                    corpusTests: NO_CORPUS,
                }).kind
            ).toBe("full");
        expect(
            repairProofPlan({
                reds: [],
                offline: OFFLINE,
                corpusTests: NO_CORPUS,
            })
        ).toEqual({ kind: "full", reason: "no RED stands" });
    });

    it("the evidence's files win over the description's cut list; a cut list with no evidence, or unreadable evidence, is the full gate", () => {
        const red = {
            sha: "a".repeat(40),
            step: "test",
            tests: ["a.test.ts"],
            testsMore: 2,
        };
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        ...red,
                        evidence: evidenceOf([
                            "a.test.ts",
                            "b.test.ts",
                            "c.test.ts",
                        ]),
                    },
                ],
                offline: OFFLINE,
                corpusTests: NO_CORPUS,
            })
        );
        expect(plan.files).toEqual(["a.test.ts", "b.test.ts", "c.test.ts"]);
        const cut = repairProofPlan({
            reds: [{ ...red, evidence: null }],
            offline: OFFLINE,
            corpusTests: NO_CORPUS,
        });
        expect(cut.kind).toBe("full");
        expect(reasonOf(cut)).toMatch(/2 more failing file/);
        const unreadable = repairProofPlan({
            reds: [{ ...red, testsMore: 0, evidenceUnreadable: true }],
            offline: OFFLINE,
            corpusTests: NO_CORPUS,
        });
        expect(unreadable.kind).toBe("full");
        expect(reasonOf(unreadable)).toMatch(/could not read/);
        // No `more`, no evidence: the description's list is whole.
        expect(
            repairProofPlan({
                reds: [{ ...red, testsMore: undefined, evidence: null }],
                offline: OFFLINE,
                corpusTests: NO_CORPUS,
            }).kind
        ).toBe("proof");
    });

    it("a RED a repair proof itself wrote → the full gate: the trust never chains", () => {
        const plan = repairProofPlan({
            reds: [
                {
                    sha: "a".repeat(40),
                    step: "test",
                    tests: ["x.test.ts"],
                    proof: "repair",
                },
            ],
            offline: OFFLINE,
            corpusTests: NO_CORPUS,
        });
        expect(plan.kind).toBe("full");
        expect(reasonOf(plan)).toMatch(/written by a repair proof/);
    });

    it("the evidence's projects and named tests ride the plan: the shared-worker re-run (issue #7584)", () => {
        const file = "convex/gre/__tests__/y.test.ts";
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    {
                        sha: "a".repeat(40),
                        step: "test",
                        evidence: evidenceOf([file], {
                            projects: ["node-engine"],
                            failLines: [
                                ` FAIL  |node-engine| ${file} > suite > case`,
                            ],
                        }),
                    },
                ],
                offline: OFFLINE,
                corpusTests: NO_CORPUS,
            })
        );
        expect(plan.projects).toEqual(["node-engine"]);
        expect(plan.tests).toEqual([{ file, name: "suite > case" }]);
        expect(
            repairProofProjectCommands(plan).map((c) => [c.args, c.env])
        ).toEqual([
            [
                [
                    "vitest",
                    "run",
                    "--project",
                    "node-engine",
                    "--no-file-parallelism",
                ],
                { TOLARIA_VITEST_RUN_LAST: file },
            ],
        ]);
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
                corpusTests: NO_CORPUS,
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
                corpusTests: NO_CORPUS,
            }).kind
        ).toBe("full");
    });

    it("a RED a GitHub-hosted run wrote skipped the corpus tests: they join the files — and the scan is asked only then", () => {
        const red = {
            sha: "a".repeat(40),
            step: "test",
            tests: ["scripts/__tests__/x.test.ts"],
        };
        let scans = 0;
        const corpusTests = () => {
            scans += 1;
            return ["convex/gre/ai/__tests__/corpus.bot.test.ts"];
        };
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
        expect(hosted.tests.map((t) => t.file)).toEqual([
            "scripts/__tests__/x.test.ts",
            "convex/gre/ai/__tests__/corpus.bot.test.ts",
        ]);
        expect(scans).toBe(1);
        const own = proofOf(
            repairProofPlan({
                reds: [{ ...red, machine: "macbook" }],
                offline: OFFLINE,
                corpusTests,
            })
        );
        expect(own.corpus).toBe(false);
        expect(own.files).toEqual(["scripts/__tests__/x.test.ts"]);
        expect(scans).toBe(1);
    });

    it("steps the RED's run passed are not in the plan", () => {
        const plan = proofOf(
            repairProofPlan({
                reds: [
                    { sha: "a".repeat(40), step: "test", tests: ["x.test.ts"] },
                ],
                offline: OFFLINE,
                corpusTests: NO_CORPUS,
            })
        );
        for (const passed of STEPS_BEFORE_TEST)
            expect(plan.unreached).not.toContain(passed);
        expect(plan.unreached).not.toContain("test:app");
        expect(plan.unreached).not.toContain("worktree:init");
    });
});

describe("repairProofNote — the GREEN's description (issue #7657)", () => {
    const base: ProofPlan = {
        kind: "proof",
        files: ["x.test.ts"],
        tests: [{ file: "x.test.ts" }],
        projects: [],
        step: "test",
        unreached: [],
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
            proof: "repair",
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
        expect(back?.proof).toBe("repair");
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

    it("a proof-written RED keeps its `proof` mark on the store before a long file list", () => {
        const sha = "c".repeat(40);
        const description = encodeDescription({
            sha,
            status: "red",
            step: "test",
            machine: "macbook",
            proof: "repair",
            failure: "assertion",
            tests: Array.from(
                { length: 12 },
                (_, i) =>
                    `convex/gre/__tests__/someLongTestFileName${i}.test.ts`
            ),
        });
        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        const back = decodeStatus({
            sha,
            state: "failure",
            description,
            targetUrl: null,
            createdAt: null,
        });
        expect(back?.proof).toBe("repair");
        expect(back?.testsMore).toBeGreaterThan(0);
        expect(isRepairProofGreen(back)).toBe(false);
    });
});

describe("runRepairProof — the flake path's order on the repair tip (issue #7657)", () => {
    const plan: ProofPlan = {
        kind: "proof",
        files: [
            "scripts/__tests__/x.test.ts",
            "convex/gre/ai/blade/__tests__/blade.shard-1.spec.ts",
        ],
        tests: [
            { file: "scripts/__tests__/x.test.ts" },
            { file: "convex/gre/ai/blade/__tests__/blade.shard-1.spec.ts" },
        ],
        projects: [],
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

    it("files that pass alone in a shared-worker project are re-run with that project whole before any unreached step (issue #7584); red there is RED at the files' step", async () => {
        const leaky: ProofPlan = {
            ...plan,
            files: ["convex/gre/__tests__/y.test.ts"],
            tests: [{ file: "convex/gre/__tests__/y.test.ts", name: "s > c" }],
            projects: ["node-engine"],
        };
        const ran: string[] = [];
        const out = await runRepairProof(leaky, {
            note: () => {},
            runFiles: (cmds) => {
                ran.push(...cmds.map((c) => c.args.join(" ")));
                // The file passes alone, the project whole fails.
                return !cmds.some((c) => c.args.includes("--project"));
            },
            runStep: (step) => {
                ran.push(`step ${step}`);
                return true;
            },
        });
        expect(out).toEqual({ outcome: "red", step: "test", ran: "test" });
        expect(ran).toEqual([
            "vitest run convex/gre/__tests__/y.test.ts",
            "vitest run --project node-engine --no-file-parallelism",
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
        expect(out).toEqual({ outcome: "red", step: "test", ran: "test" });
        expect(steps).toEqual([]);
    });

    it("a failing unreached chain tier is RED at step `test` (what the ladder's fresh run reads), naming the tier it ran; a failing guard at its own name", async () => {
        const steps: string[] = [];
        const out = await runRepairProof(plan, {
            note: () => {},
            runFiles: async () => true,
            runStep: async (s) => {
                steps.push(s);
                return s !== "test:bot";
            },
        });
        expect(out).toEqual({ outcome: "red", step: "test", ran: "test:bot" });
        expect(steps).toEqual(["test:bot"]);
        expect(
            await runRepairProof(plan, {
                note: () => {},
                runFiles: () => true,
                runStep: (s) => s !== "check:gaps",
            })
        ).toEqual({ outcome: "red", step: "check:gaps", ran: "check:gaps" });
        expect(redStepOf("test:blade")).toBe("test");
        expect(redStepOf("check:targets")).toBe("check:targets");
    });

    it("no file left (every one deleted by the repair) runs the unreached steps alone", async () => {
        let files = 0;
        const out = await runRepairProof(
            { ...plan, files: [], tests: [] },
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

describe("resolveMovedFiles — the failing files as the tip holds them (issue #7657)", () => {
    it("present runs at its path, renamed at the new one, deleted is dropped, anything else is unknown (the full gate)", () => {
        const r = resolveMovedFiles(
            ["a.test.ts", "old/b.test.ts", "c.test.ts", "d.test.ts"],
            (f) => f === "a.test.ts",
            {
                renamed: new Map([["old/b.test.ts", "new/b.test.ts"]]),
                deleted: new Set(["c.test.ts"]),
            }
        );
        expect(r.files).toEqual(["a.test.ts", "new/b.test.ts"]);
        expect(r.deleted).toEqual(["c.test.ts"]);
        expect(r.unknown).toEqual(["d.test.ts"]);
        expect([...r.mapped]).toEqual([
            ["a.test.ts", "a.test.ts"],
            ["old/b.test.ts", "new/b.test.ts"],
        ]);
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

    it("null with no repair declared, with no closing PR, or past the run's cap of PR commits (generated commits not counted)", () => {
        expect(
            declaredRepairAmong({ commits, repairIssues: [], closedBy })
        ).toBeNull();
        expect(
            declaredRepairAmong({ commits, repairIssues: [99], closedBy })
        ).toBeNull();
        const pr = (i: number) => ({
            sha: String(i).padStart(40, "0"),
            pr: 42,
        });
        const generated = (i: number) => ({
            sha: String(i).padStart(40, "9"),
            pr: null,
        });
        const long = Array.from(
            { length: MAX_PR_COMMITS_SINCE_RED + 1 },
            (_, i) => pr(i)
        );
        expect(
            declaredRepairAmong({
                commits: long,
                repairIssues: [7],
                closedBy: () => [7],
            })
        ).toBeNull();
        const padded = [
            ...Array.from({ length: MAX_PR_COMMITS_SINCE_RED }, (_, i) =>
                generated(i)
            ),
            ...Array.from({ length: MAX_PR_COMMITS_SINCE_RED }, (_, i) =>
                pr(i)
            ),
        ];
        expect(
            declaredRepairAmong({
                commits: padded,
                repairIssues: [7],
                closedBy: () => [7],
            })
        ).toEqual(pr(0));
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
