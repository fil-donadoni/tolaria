import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as nodeFs from "node:fs";
import * as os from "os";
import * as path from "path";

// `writeBoardPriorityCache` (issue #2520 round 2) imports from the "node:fs"
// specifier — the SAME specifier must be mocked here, or the module namespace
// stays non-configurable and `vi.spyOn` throws ("Module namespace is not
// configurable in ESM"). Every export defaults to the real implementation;
// only `renameSync` is wrapped so a single test can simulate a crash between
// the temp-file write and the rename.
vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
import {
    planBatch,
    pathsOverlap,
    normalizePath,
    isAppendOnlyPath,
    EVERYTHING,
    buildPlanRecord,
    planFilename,
    type BatchPlan,
    type BoardPriority,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "../lib/queue-plan";
import {
    isRateLimitError,
    isCacheFresh,
    liveFetchBoardPriority,
    formatSnapshotAge,
    resolveBoardPriority,
    boardPriorityForArgv,
    rateLimitFallbackMessage,
    readBoardPriorityCache,
    writeBoardPriorityCache,
    NO_PRIORITY_MESSAGE,
    type BoardPriorityDeps,
    type BoardPrioritySnapshot,
} from "../queue-plan";

/**
 * Queue planner — the loop's scheduling contract (issue #2181, PRD #2180).
 *
 * `/process-gh-issues` used to derive its batch by having a model read ~150
 * lines of prose and hand-roll a `jq` query every pass. That layer's failures
 * are SILENT and PLAUSIBLE: a wrong batch looks exactly like a right one, and
 * the documented `index("bug")` trap inverted the bug priority across half the
 * queue while skipping five older bugs — with nothing red anywhere.
 *
 * So every test here asserts an externally observable DECISION — the exact
 * batch, in the exact order, with the exact skips — never an intermediate such
 * as a comparator's return value. The fixture set is the incident list: each
 * shape below is a failure the loop actually paid for.
 */

const FIXTURES = path.resolve(__dirname, "fixtures", "queue");

/** The real `gh issue list` payload, captured 2026-08-04. Its job is shape
 *  compatibility: if the CLI's response changes, a test breaks instead of the
 *  loop. */
const LIVE_QUEUE = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "live-queue.json"), "utf8")
) as QueueIssue[];

const NOW = "2026-08-04T12:00:00Z";

const CONFIG: PlanConfig = {
    batchCap: 4,
    staleClaimHours: 24,
    defaultImplModel: "sonnet",
    now: NOW,
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixture builders.
//
// These synthesize the incident shapes. They are tied to reality by
// `matches the real gh payload shape` below — a synthetic fixture that has
// drifted from the CLI's actual response tests nothing.
// ─────────────────────────────────────────────────────────────────────────────

function issue(
    number: number,
    opts: {
        title?: string;
        labels?: string[];
        parent?: number | null;
        assignees?: string[];
        updatedAt?: string;
    } = {}
): QueueIssue {
    return {
        number,
        title: opts.title ?? `issue ${number}`,
        labels: (opts.labels ?? ["enhancement", "ready-for-agent"]).map(
            (name) => ({
                id: `LA_${name}`,
                name,
                description: "",
                color: "ffffff",
            })
        ),
        parent:
            opts.parent == null
                ? null
                : {
                      id: `I_${opts.parent}`,
                      number: opts.parent,
                      state: "OPEN",
                      title: `parent ${opts.parent}`,
                      url: `https://example.invalid/${opts.parent}`,
                  },
        assignees: (opts.assignees ?? []).map((login) => ({ login })),
        updatedAt: opts.updatedAt ?? NOW,
    };
}

/**
 * A realistic issue body.
 *
 * It carries acceptance criteria and a full prose paragraph because the planner
 * now runs `lintIssue` before admitting (issue #2188), and a stub body is
 * itself a blocking finding — as it should be: an issue with no spec wastes a
 * full implement + review cycle. A fixture that would be rejected in production
 * is not a fixture, it is a different scenario.
 */
function body(opts: {
    targetFiles?: string[] | null;
    blockedBy?: number[];
    prose?: string;
}): string {
    const parts = [
        "## What to build",
        "",
        opts.prose ??
            "Some behaviour the loop needs, described at enough length that the body is a spec rather than a title repeated twice.",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] the behaviour above works end to end",
        "- [ ] a test covers it and has been proven to fail",
        "",
    ];
    if (opts.blockedBy?.length) {
        parts.push("## Blocked by", "");
        for (const n of opts.blockedBy) parts.push(`- #${n}`);
        parts.push("");
    }
    if (opts.targetFiles !== null) {
        parts.push("## Target files", "");
        for (const f of opts.targetFiles ?? ["src/default.ts"])
            parts.push(`- \`${f}\``);
    }
    return parts.join("\n");
}

/** A port backed by in-memory maps, counting round-trips — the planner's call
 *  count is part of its contract (two-stage selection). */
function makePort(
    details: Record<number, Partial<IssueDetail> & { body?: string }>,
    openPr: number[] = [],
    priority: Record<number, BoardPriority> = {}
): QueuePort & { calls: number[] } {
    const calls: number[] = [];
    return {
        calls,
        issuesWithOpenPr: openPr,
        priority,
        issueDetail(number: number): IssueDetail {
            calls.push(number);
            const d = details[number];
            if (!d) throw new Error(`no fixture detail for #${number}`);
            return {
                state: d.state ?? "OPEN",
                labels: d.labels ?? ["enhancement", "ready-for-agent"],
                body: d.body ?? "",
            };
        },
    };
}

const numbers = (plan: BatchPlan) => plan.batch.map((b) => b.number);
const deferredNumbers = (plan: BatchPlan) => plan.deferred.map((d) => d.number);

describe("queue planner — fixture shape (issue #2181)", () => {
    it("matches the real gh payload shape", () => {
        const real = LIVE_QUEUE[0];
        const synthetic = issue(1, { parent: 2 });
        // Every key the real payload carries must exist on the builder, or the
        // synthetic fixtures below are testing a shape the CLI never returns.
        for (const key of Object.keys(real)) {
            expect(synthetic).toHaveProperty(key);
        }
        for (const key of Object.keys(real.labels[0] ?? {})) {
            expect(synthetic.labels[0]).toHaveProperty(key);
        }
        const realParent = LIVE_QUEUE.find((i) => i.parent != null)!.parent!;
        for (const key of Object.keys(realParent)) {
            expect(synthetic.parent).toHaveProperty(key);
        }
    });

    it("plans the real captured queue without throwing, and resolves a model for every admitted issue", () => {
        const details: Record<number, { body: string }> = {};
        for (const i of LIVE_QUEUE)
            details[i.number] = { body: body({ targetFiles: null }) };
        const plan = planBatch(LIVE_QUEUE, CONFIG, makePort(details));

        expect(plan.batch.length).toBeGreaterThan(0);
        expect(plan.batch.length).toBeLessThanOrEqual(CONFIG.batchCap);
        for (const admitted of plan.batch) {
            expect(admitted.model).toBeTruthy();
        }
        // The plan must survive the wire — the CLI prints it as JSON.
        expect(() => JSON.stringify(plan)).not.toThrow();
    });
});

describe("queue planner — priority (issue #2181)", () => {
    it("puts bugs first even when `bug` is the FIRST label (the falsy-index regression)", () => {
        // The jq trap: `index("bug")` returns position 0 for a first-position
        // label, and 0 is falsy — so "bug is first" classified identically to
        // "no bug label at all". Observed 2026-08-04: inverted the key on half
        // the queue and silently skipped five older bugs.
        const issues = [
            issue(10, { labels: ["enhancement", "ready-for-agent"] }),
            issue(20, { labels: ["bug", "ready-for-agent"] }), // bug FIRST
            issue(30, { labels: ["ready-for-agent", "bug"] }), // bug LAST
        ];
        const details = {
            10: { body: body({ targetFiles: ["src/a.ts"] }) },
            20: { body: body({ targetFiles: ["src/b.ts"] }) },
            30: { body: body({ targetFiles: ["src/c.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([20, 30, 10]);
    });

    it("sorts by lineage (parent number), so an old umbrella's children do not starve behind the queue", () => {
        const issues = [
            issue(500, { parent: null }), // standalone, older than the child
            issue(900, { parent: 100 }), // child of a much older PRD
            issue(600, { parent: null }),
        ];
        const details = {
            500: { body: body({ targetFiles: ["src/a.ts"] }) },
            600: { body: body({ targetFiles: ["src/b.ts"] }) },
            900: { body: body({ targetFiles: ["src/c.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([900, 500, 600]);
    });

    it("sorts a slice with no parent edge on its own number — graceful degradation, not an error", () => {
        const issues = [
            issue(900, { parent: null }),
            issue(800, { parent: null }),
        ];
        const details = {
            800: { body: body({ targetFiles: ["src/a.ts"] }) },
            900: { body: body({ targetFiles: ["src/b.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([800, 900]);
    });
});

/**
 * The board's `Priority` field — the maintainer's live override.
 *
 * The keys below it (bug, lineage, number) are DEFAULTS: reasonable guesses for
 * the issues nobody has ruled on, which is nearly all of them. Priority is the
 * one input whose criteria change week to week, so it is the zeroth key and it
 * beats every default, `bug` included. These tests pin that ordering, because
 * "a P2 sorted above a bug" reads like a regression to anyone who does not know
 * it is the entire point.
 */
describe("queue planner — board priority (GitHub Project `Priority` field)", () => {
    const disjoint = (...ns: number[]) =>
        Object.fromEntries(
            ns.map((n) => [
                n,
                { body: body({ targetFiles: [`src/f${n}.ts`] }) },
            ])
        );

    it("lifts prioritized issues above everything unprioritized, ordered P0 → P1 → P2", () => {
        const issues = [issue(10), issue(20), issue(30), issue(40), issue(50)];
        const plan = planBatch(
            issues,
            { ...CONFIG, batchCap: 5 },
            makePort(disjoint(10, 20, 30, 40, 50), [], {
                50: "P0",
                30: "P1",
                40: "P2",
            })
        );
        expect(numbers(plan)).toEqual([50, 30, 40, 10, 20]);
    });

    it("puts a P2 above an unprioritized BUG — the human override outranks the default", () => {
        // The whole reason the field exists. If this inverts, the board is
        // decorative: the maintainer sets a priority and the loop ignores it in
        // favour of a heuristic that has never seen this week's context.
        const issues = [
            issue(10, { labels: ["bug", "ready-for-agent"] }),
            issue(20, { labels: ["enhancement", "ready-for-agent"] }),
        ];
        const plan = planBatch(
            issues,
            CONFIG,
            makePort(disjoint(10, 20), [], { 20: "P2" })
        );
        expect(numbers(plan)).toEqual([20, 10]);
    });

    it("leaves the existing bug → lineage → number order intact BELOW the prioritized ones", () => {
        const issues = [
            issue(500, { parent: null }),
            issue(900, { parent: 100 }), // child of an old PRD
            issue(600, { labels: ["bug", "ready-for-agent"] }),
            issue(700, { parent: null }),
        ];
        const plan = planBatch(
            issues,
            CONFIG,
            makePort(disjoint(500, 600, 700, 900), [], { 700: "P1" })
        );
        // 700 jumps on priority; the rest keep bug-first, then oldest lineage.
        expect(numbers(plan)).toEqual([700, 600, 900, 500]);
    });

    it("treats 'on the board with no Priority set' exactly like 'not on the board'", () => {
        // A board where only the urgent few carry a value is the intended
        // steady state. If the planner distinguished the two, adding an issue
        // to the board would silently reorder it.
        const issues = [issue(10), issue(20)];
        const onBoardNoValue = planBatch(
            issues,
            CONFIG,
            makePort(disjoint(10, 20), [], {})
        );
        expect(numbers(onBoardNoValue)).toEqual([10, 20]);
    });

    it("echoes the priority on the admitted issue, and omits the key when there is none", () => {
        // The plan must say WHY an issue jumped. An unexplained reordering
        // reads as a planner bug and gets "fixed".
        const plan = planBatch(
            [issue(10), issue(20)],
            CONFIG,
            makePort(disjoint(10, 20), [], { 20: "P0" })
        );
        expect(plan.batch[0]).toMatchObject({ number: 20, priority: "P0" });
        expect(plan.batch[1]).not.toHaveProperty("priority");
    });
});

describe("queue planner — eligibility (issue #2181)", () => {
    it("skips a `prd`-labelled umbrella and demands the stray ready-for-agent label be stripped", () => {
        // A PRD carrying ready-for-agent is a data defect: the loop skips it on
        // every pass forever AND it permanently falsifies the stop condition
        // ("no unclaimed ready-for-agent issues"), because it is never claimed.
        const issues = [
            issue(100, { labels: ["prd", "ready-for-agent"] }),
            issue(200, {}),
        ];
        const details = { 200: { body: body({ targetFiles: ["src/a.ts"] }) } };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([200]);
        expect(plan.skipped).toContainEqual(
            expect.objectContaining({ number: 100, action: "strip-ready" })
        );
    });

    it("leaves an issue claimed by another session alone, and does not call it stale while it is fresh", () => {
        const issues = [
            issue(100, {
                labels: ["ready-for-agent", "in-progress"],
                updatedAt: NOW,
            }),
            issue(200, {}),
        ];
        const details = { 200: { body: body({ targetFiles: ["src/a.ts"] }) } };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([200]);
        expect(plan.staleClaims).toEqual([]);
        expect(deferredNumbers(plan)).toContain(100);
    });

    it("reports a claim past the stale threshold with no open PR", () => {
        const issues = [
            issue(100, {
                labels: ["ready-for-agent", "in-progress"],
                updatedAt: "2026-08-01T12:00:00Z", // 3 days old
            }),
        ];
        const plan = planBatch(issues, CONFIG, makePort({}));
        expect(plan.staleClaims).toEqual([100]);
    });

    it("does not report a stale-looking claim that has an open PR — the PR is the liveness signal", () => {
        const issues = [
            issue(100, {
                labels: ["ready-for-agent", "in-progress"],
                updatedAt: "2026-08-01T12:00:00Z",
            }),
        ];
        const plan = planBatch(issues, CONFIG, makePort({}, [100]));
        expect(plan.staleClaims).toEqual([]);
    });

    it("leaves an assigned issue out of the batch", () => {
        const issues = [issue(100, { assignees: ["someone"] }), issue(200, {})];
        const details = { 200: { body: body({ targetFiles: ["src/a.ts"] }) } };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([200]);
    });
});

describe("queue planner — unmergeable work (issue #2181)", () => {
    it("refuses CI-config work: pushing it needs an OAuth scope only an interactive refresh grants", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: {
                body: body({ targetFiles: [".github/workflows/test.yml"] }),
            },
            200: { body: body({ targetFiles: ["src/a.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([200]);
        expect(plan.skipped).toContainEqual(
            expect.objectContaining({ number: 100, action: "relabel-human" })
        );
    });

    it("refuses work whose files live outside the repository — no PR can carry it", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: {
                body: body({ targetFiles: ["~/.claude/skills/foo/SKILL.md"] }),
            },
            200: { body: body({ targetFiles: ["src/a.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([200]);
        expect(plan.skipped).toContainEqual(
            expect.objectContaining({ number: 100, action: "relabel-human" })
        );
    });
});

describe("queue planner — dependencies (issue #2181)", () => {
    it("defers an issue blocked by an open ticket, naming the blocker", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: {
                body: body({
                    targetFiles: ["src/a.ts"],
                    blockedBy: [999],
                }),
            },
            200: { body: body({ targetFiles: ["src/b.ts"] }) },
            999: { state: "OPEN" as const, body: "" },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([200]);
        expect(plan.deferred).toContainEqual(
            expect.objectContaining({ number: 100, conflictsWith: 999 })
        );
    });

    it("admits an issue whose blocker is closed", () => {
        const issues = [issue(100, {})];
        const details = {
            100: {
                body: body({ targetFiles: ["src/a.ts"], blockedBy: [999] }),
            },
            999: { state: "CLOSED" as const, body: "" },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
    });

    it("reads a prose dependency keyword, not only the Blocked-by section", () => {
        const issues = [issue(100, {})];
        const details = {
            100: {
                body: body({
                    targetFiles: ["src/a.ts"],
                    prose: "This one depends on #999 landing first.",
                }),
            },
            999: { state: "OPEN" as const, body: "" },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([]);
        expect(deferredNumbers(plan)).toEqual([100]);
    });

    it("ignores a self-reference — an issue that blocks itself would starve forever", () => {
        // Silent starvation: the planner would ask the port for its own state,
        // get OPEN, and defer the issue on every pass for the rest of time.
        const issues = [issue(100, {})];
        const details = {
            100: {
                body: body({
                    targetFiles: ["src/a.ts"],
                    prose: "Supersedes the cleanup left over after #100.",
                }),
            },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
    });

    it("does not mistake the Parent reference for a dependency", () => {
        const issues = [issue(100, { parent: 50 })];
        const details = {
            100: {
                body: `## Parent\n\n#50\n\n${body({ targetFiles: ["src/a.ts"] })}`,
            },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
    });

    it("never puts an issue and its blocker in the same batch", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: {
                body: body({ targetFiles: ["src/b.ts"], blockedBy: [100] }),
            },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
        expect(deferredNumbers(plan)).toEqual([200]);
    });
});

describe("queue planner — disjointness (issue #2181)", () => {
    it("defers an issue that shares a target file with one already admitted", () => {
        const issues = [issue(100, {}), issue(200, {}), issue(300, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/shared.ts"] }) },
            200: { body: body({ targetFiles: ["src/shared.ts"] }) },
            300: { body: body({ targetFiles: ["src/other.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([100, 300]);
        expect(plan.deferred).toContainEqual(
            expect.objectContaining({ number: 200, conflictsWith: 100 })
        );
    });

    it("treats a glob and a file underneath it as an overlap", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/components/**"] }) },
            200: { body: body({ targetFiles: ["src/components/Card.tsx"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
    });

    it("does not serialize a batch over an append-only registration point", () => {
        // Shared files where every issue merely ADDS an entry are absorbed by
        // the merge-train's rebase; treating them as edges would serialize
        // every batch that ships a card.
        const config: PlanConfig = {
            ...CONFIG,
            appendOnlyPaths: ["convex/cards/index.ts"],
        };
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: {
                body: body({
                    targetFiles: [
                        "convex/cards/sets/lea/red.ts",
                        "convex/cards/index.ts",
                    ],
                }),
            },
            200: {
                body: body({
                    targetFiles: [
                        "convex/cards/sets/lea/blue.ts",
                        "convex/cards/index.ts",
                    ],
                }),
            },
        };
        const plan = planBatch(issues, config, makePort(details));
        expect(numbers(plan)).toEqual([100, 200]);
    });

    it("plans an issue with no declared target files SOLO — an unknown blast radius overlaps everything", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: null }) },
            200: { body: body({ targetFiles: ["src/a.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([100]);
        expect(plan.batch[0].blastRadius).toBe("unknown");
        expect(deferredNumbers(plan)).toEqual([200]);
    });

    it("plans a declared `- *` blast radius SOLO too", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["*"] }) },
            200: { body: body({ targetFiles: ["src/a.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
        expect(plan.batch[0].blastRadius).toBe("everything");
    });

    it("does not admit a solo issue alongside one already in the batch", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: { body: body({ targetFiles: null }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
        expect(deferredNumbers(plan)).toEqual([200]);
    });

    it("batches an issue whose file set the orchestrator inferred, and tags it as inferred", () => {
        // Most of the existing queue predates the `Target files:` convention. A
        // planner that only refuses would degenerate to a solo batch on nearly
        // every pass — measured against the live queue, the first candidate
        // closed the batch and the other 20 were deferred behind it. The
        // judgment stays with the model; the arithmetic stays in the planner.
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: null }) },
            200: { body: body({ targetFiles: ["src/b.ts"] }) },
        };
        const plan = planBatch(
            issues,
            { ...CONFIG, inferredTargetFiles: { 100: ["src/a.ts"] } },
            makePort(details)
        );

        expect(numbers(plan)).toEqual([100, 200]);
        expect(plan.batch[0].blastRadius).toBe("inferred");
        expect(plan.batch[0].targetFiles).toEqual(["src/a.ts"]);
    });

    it("applies disjointness to an inferred set exactly as to a declared one", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: null }) },
            200: { body: body({ targetFiles: ["src/shared.ts"] }) },
        };
        const plan = planBatch(
            issues,
            { ...CONFIG, inferredTargetFiles: { 100: ["src/shared.ts"] } },
            makePort(details)
        );

        expect(numbers(plan)).toEqual([100]);
        expect(plan.deferred).toContainEqual(
            expect.objectContaining({ number: 200, conflictsWith: 100 })
        );
    });

    it("lets a declaration beat an override — the issue's own section is authoritative", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/declared.ts"] }) },
            200: { body: body({ targetFiles: ["src/guessed.ts"] }) },
        };
        const plan = planBatch(
            issues,
            { ...CONFIG, inferredTargetFiles: { 100: ["src/guessed.ts"] } },
            makePort(details)
        );

        // If the override had won, #100 would own `src/guessed.ts` and #200
        // would have been deferred as an overlap.
        expect(numbers(plan)).toEqual([100, 200]);
        expect(plan.batch[0].blastRadius).toBe("declared");
    });

    it("honours the batch cap", () => {
        const issues = [100, 200, 300, 400, 500].map((n) => issue(n, {}));
        const details = Object.fromEntries(
            [100, 200, 300, 400, 500].map((n) => [
                n,
                { body: body({ targetFiles: [`src/${n}.ts`] }) },
            ])
        );
        const plan = planBatch(
            issues,
            { ...CONFIG, batchCap: 2 },
            makePort(details)
        );
        expect(numbers(plan)).toEqual([100, 200]);
    });
});

describe("queue planner — lane homogeneity (issue #2743, closing PRD #2738)", () => {
    // Every case here classifies `lane` from `targetFiles` with the SAME
    // `classifyPath`/`laneFor` predicate `check:lane` runs against a real
    // diff (scripts/check-lane.ts) — never from the issue's `area:*` label,
    // which none of these fixtures even sets. That is the point: the label
    // is a hypothesis a human writes before the code exists, and the planner
    // never reads it for this decision.

    it("admits two skin-only issues into one batch and tags them `skin`", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: { body: body({ targetFiles: ["src/b.tsx"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([100, 200]);
        expect(plan.lane).toBe("skin");
        expect(plan.batch.map((b) => b.lane)).toEqual(["skin", "skin"]);
    });

    it("admits two engine-only issues into one batch and tags them `engine`", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["convex/gre/state.ts"] }) },
            200: { body: body({ targetFiles: ["scripts/gate.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([100, 200]);
        expect(plan.lane).toBe("engine");
        expect(plan.batch.every((b) => b.lane === "engine")).toBe(true);
    });

    it("defers a skin issue that would join an engine batch — cross-lane, not just disjoint", () => {
        // The two issues' files do not even overlap (`convex/gre/state.ts` vs
        // `src/a.ts`), so the pre-#2743 disjointness check alone would have
        // admitted both. Lane homogeneity is a SEPARATE, stricter rule.
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["convex/gre/state.ts"] }) },
            200: { body: body({ targetFiles: ["src/a.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([100]);
        expect(plan.lane).toBe("engine");
        expect(plan.deferred).toContainEqual(
            expect.objectContaining({
                number: 200,
                conflictsWith: 100,
                reason: expect.stringContaining("lane mismatch"),
            })
        );
    });

    it("computes lane from real target files, never from the area:* label — a UI-labelled issue whose diff reaches convex/** is `full`, and it does not corrupt the batch (acceptance criterion 2)", () => {
        const issues = [
            issue(100, { labels: ["area:ui-ux", "ready-for-agent"] }),
            // Mislabelled: carries the UI hypothesis but its OWN declared
            // files also reach convex/**, so its real lane is `full`.
            issue(200, { labels: ["area:ui-ux", "ready-for-agent"] }),
            issue(300, { labels: ["area:ui-ux", "ready-for-agent"] }),
        ];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: {
                body: body({
                    targetFiles: ["src/b.ts", "convex/cards/sets/lea/red.ts"],
                }),
            },
            300: { body: body({ targetFiles: ["src/c.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        // #100 sets the batch lane to `skin`. #200's real files land in
        // `full` despite its `area:ui-ux` label, so it is deferred — the
        // mislabel degrades it to a stricter gate, it does not corrupt
        // anyone else's admission. #300, genuinely skin, still joins.
        expect(numbers(plan)).toEqual([100, 300]);
        expect(plan.lane).toBe("skin");
        expect(plan.deferred).toContainEqual(
            expect.objectContaining({
                number: 200,
                conflictsWith: 100,
                reason: expect.stringContaining("lane mismatch"),
            })
        );
        expect(plan.deferred.find((d) => d.number === 200)!.reason).toContain(
            "full"
        );
    });

    it("computes lane from the diff even when the area:* label points the other way — an area:mechanics issue touching only src/** is `skin`", () => {
        const issues = [
            issue(100, { labels: ["area:mechanics", "ready-for-agent"] }),
        ];
        const details = {
            100: { body: body({ targetFiles: ["src/only.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(plan.batch[0].lane).toBe("skin");
    });

    it("lets `full`-lane issues keep batching together exactly as before #2743 (no new constraint among themselves)", () => {
        // Neither file is under src/**, convex/** or scripts/**, so both are
        // individually `full` by the fail-closed default — and were already
        // batchable together under plain disjointness before this issue.
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["docs/a.md"] }) },
            200: { body: body({ targetFiles: ["docs/b.md"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(numbers(plan)).toEqual([100, 200]);
        expect(plan.lane).toBe("full");
    });

    it("leaves `lane` undefined on an empty batch", () => {
        const plan = planBatch([], CONFIG, makePort({}));
        expect(plan.batch).toEqual([]);
        expect(plan.lane).toBeUndefined();
    });
});

describe("queue planner — model routing (issue #2181)", () => {
    it("resolves the tier from the label, and falls back to the configured default", () => {
        const issues = [
            issue(100, { labels: ["ready-for-agent", "model:opus"] }),
            issue(200, {}),
        ];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: { body: body({ targetFiles: ["src/b.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(plan.batch[0].model).toBe("opus");
        expect(plan.batch[1].model).toBe("sonnet");
    });

    it("takes the most capable tier when an issue carries several, and reports the ambiguity", () => {
        const issues = [
            issue(100, {
                labels: ["ready-for-agent", "model:sonnet", "model:opus"],
            }),
        ];
        const details = { 100: { body: body({ targetFiles: ["src/a.ts"] }) } };
        const plan = planBatch(issues, CONFIG, makePort(details));

        expect(plan.batch[0].model).toBe("opus");
        expect(plan.batch[0].modelAmbiguity).toEqual(["sonnet", "opus"]);
    });

    it("marks a bug as a fix and everything else as a feat", () => {
        const issues = [
            issue(100, { labels: ["bug", "ready-for-agent"] }),
            issue(200, {}),
        ];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: { body: body({ targetFiles: ["src/b.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(plan.batch.map((b) => b.type)).toEqual(["fix", "feat"]);
    });

    it("carries the HITL flag through so the loop leaves the PR for a human", () => {
        const issues = [issue(100, {})];
        const details = {
            100: {
                body: `⚠️ HITL\n\n${body({ targetFiles: ["src/a.ts"] })}`,
            },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(plan.batch[0].hitl).toBe(true);
    });
});

describe("queue planner — determinism and cost (issue #2181)", () => {
    it("returns the same plan for the same snapshot", () => {
        const details: Record<number, { body: string }> = {};
        for (const i of LIVE_QUEUE)
            details[i.number] = { body: body({ targetFiles: null }) };
        const a = planBatch(LIVE_QUEUE, CONFIG, makePort(details));
        const b = planBatch(LIVE_QUEUE, CONFIG, makePort(details));
        expect(a).toEqual(b);
    });

    it("reads no clock — a different injected `now` changes nothing when no claim is near the threshold", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["src/a.ts"] }) },
            200: { body: body({ targetFiles: ["src/b.ts"] }) },
        };
        const a = planBatch(issues, CONFIG, makePort(details));
        const b = planBatch(
            issues,
            { ...CONFIG, now: "2030-01-01T00:00:00Z" },
            makePort(details)
        );
        expect(a).toEqual(b);
    });

    it("fetches bodies only for the candidates it considers — selection cost scales with the batch, not the queue", () => {
        const issues = Array.from({ length: 40 }, (_, i) => issue(100 + i, {}));
        const details = Object.fromEntries(
            issues.map((i) => [
                i.number,
                { body: body({ targetFiles: [`src/${i.number}.ts`] }) },
            ])
        );
        const port = makePort(details);
        const plan = planBatch(issues, { ...CONFIG, batchCap: 4 }, port);

        expect(plan.batch).toHaveLength(4);
        // Four admitted, so four bodies. A planner that pulled the whole queue
        // would be at 40 — the exact cost two-stage selection exists to avoid.
        expect(port.calls).toEqual([100, 101, 102, 103]);
    });
});

describe("a broad declaration must not exempt itself from disjointness (live-queue defect)", () => {
    /**
     * The append-only exclusion asks "may I ignore this path when checking
     * disjointness". It used symmetric containment, so a DIRECTORY that merely
     * CONTAINS a registration point classified as append-only and vanished from
     * `comparable` — `convex/gre/**` contains `convex/gre/serialize.ts`, so the
     * whole engine directory was exempted and the issue read as conflict-free
     * with everything.
     *
     * Observed on the live queue: two issues both editing `convex/gre/state.ts`
     * landed in the same batch. That is the one wrong answer the fan-out cannot
     * survive — two subagents in overlapping trees.
     */
    it("a directory containing a registration point is NOT append-only", () => {
        expect(isAppendOnlyPath("convex/gre", "convex/gre/serialize.ts")).toBe(
            false
        );
        expect(isAppendOnlyPath("convex", "convex/cards/index.ts")).toBe(false);
    });

    it("the registration point itself still is", () => {
        // The direction that must keep working: without it every card-shipping
        // batch serialises on `convex/cards/index.ts`.
        expect(
            isAppendOnlyPath("convex/cards/index.ts", "convex/cards/index.ts")
        ).toBe(true);
    });

    it("keeps two engine issues out of the same batch when one declares a glob", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["convex/gre/**"] }) },
            200: { body: body({ targetFiles: ["convex/gre/state.ts"] }) },
        };
        const plan = planBatch(issues, CONFIG, makePort(details));
        expect(numbers(plan)).toEqual([100]);
    });
});

describe("`- *` means the whole repo", () => {
    it("normalizes to the everything-matcher", () => {
        // It survived every decoration strip and then collided with NOTHING,
        // so an issue declaring the whole repo batched beside all of them.
        expect(normalizePath("- `*`")).toBe(EVERYTHING);
        expect(normalizePath("- **")).toBe(EVERYTHING);
    });

    it("collides with every path", () => {
        expect(pathsOverlap(EVERYTHING, "convex/gre/state.ts")).toBe(true);
        expect(pathsOverlap("src/components/Hand.tsx", EVERYTHING)).toBe(true);
    });

    it("closes the batch around itself", () => {
        const issues = [issue(100, {}), issue(200, {})];
        const details = {
            100: { body: body({ targetFiles: ["*"] }) },
            200: { body: body({ targetFiles: ["src/components/Hand.tsx"] }) },
        };
        expect(numbers(planBatch(issues, CONFIG, makePort(details)))).toEqual([
            100,
        ]);
    });
});

describe("normal paths keep their existing behaviour", () => {
    it("a glob still collides with a file underneath it", () => {
        expect(
            pathsOverlap(
                normalizePath("src/components/**"),
                normalizePath("src/components/Card.tsx")
            )
        ).toBe(true);
    });

    it("genuinely disjoint card files stay disjoint", () => {
        expect(
            pathsOverlap(
                "convex/cards/sets/ice/white.ts",
                "convex/cards/sets/leg/red.ts"
            )
        ).toBe(false);
    });

    it("a shared filename PREFIX is not containment", () => {
        expect(
            pathsOverlap("convex/gre/state.ts", "convex/gre/stateAdapter.ts")
        ).toBe(false);
    });
});

describe("plan artefact (issue #2518)", () => {
    // A hand-picked batch was indistinguishable from a planned one, after the
    // fact — nothing recorded which plan a claim came from. These tests pin
    // the artefact's shape, since `claim-ledger.sh` (a shell script, outside
    // vitest's reach) parses it with `jq` against exactly this contract:
    // `record.session`, `record.noPriority` and `record.plan.batch[].number`.
    // A silent rename of any of those fields would not fail here — it would
    // fail SILENTLY in the hook, which is the whole failure mode this issue
    // exists to close.

    const SAMPLE_PLAN: BatchPlan = {
        version: 1,
        batch: [
            {
                number: 2511,
                title: "fix the P0",
                type: "fix",
                model: "sonnet",
                hitl: false,
                priority: "P0",
                targetFiles: ["convex/gre/state.ts"],
                blastRadius: "declared",
                reason: "admitted — declared target files, disjoint from the rest of the batch",
            },
        ],
        deferred: [
            {
                number: 1852,
                reason: "claimed by another session",
                conflictsWith: null,
            },
        ],
        skipped: [],
        staleClaims: [],
    };

    describe("buildPlanRecord", () => {
        it("names the session, the plan, and whether priority was applied", () => {
            const record = buildPlanRecord(
                SAMPLE_PLAN,
                "sess-A",
                "2026-08-18T00:00:00Z",
                false
            );
            expect(record).toEqual({
                version: 1,
                session: "sess-A",
                ts: "2026-08-18T00:00:00Z",
                noPriority: false,
                plan: SAMPLE_PLAN,
            });
        });

        it("records --no-priority so a default-order plan cannot read back as prioritised", () => {
            const record = buildPlanRecord(
                SAMPLE_PLAN,
                "sess-A",
                "2026-08-18T00:00:00Z",
                true
            );
            expect(record.noPriority).toBe(true);
        });

        it("preserves the priority read for each admitted issue", () => {
            // The load-bearing field for the guard: a claim's plan lookup is
            // only as good as the admitted batch it can compare against.
            const record = buildPlanRecord(
                SAMPLE_PLAN,
                "sess-A",
                "2026-08-18T00:00:00Z",
                false
            );
            expect(record.plan.batch.map((p) => p.number)).toEqual([2511]);
            expect(record.plan.batch[0].priority).toBe("P0");
        });

        it("does not invent a session id — an absent one stays the empty string", () => {
            // A manual, non-Claude-Code invocation carries no session. Guessing
            // one would let a claim falsely join to some OTHER session's plan;
            // recording the absence is what lets a later reader tell the two
            // apart.
            const record = buildPlanRecord(
                SAMPLE_PLAN,
                "",
                "2026-08-18T00:00:00Z",
                false
            );
            expect(record.session).toBe("");
        });
    });

    describe("planFilename", () => {
        it("joins session and a sortable timestamp", () => {
            const name = planFilename("sess-A", "2026-08-18T00:00:00.000Z");
            expect(name).toBe(
                `sess-A-${Date.parse("2026-08-18T00:00:00.000Z")}.json`
            );
        });

        it("orders chronologically under a plain lexicographic sort", () => {
            // `claim-ledger.sh` finds "the latest plan for this session" with
            // `ls | sort | tail -1` — no JSON parsing. That only works if two
            // filenames for the same session sort the same way their
            // timestamps do.
            const earlier = planFilename("sess-A", "2026-08-18T00:00:00.000Z");
            const later = planFilename("sess-A", "2026-08-18T00:05:00.000Z");
            expect([later, earlier].sort()).toEqual([earlier, later]);
        });

        it("falls back to `unknown` for an empty session, never a bare leading dash", () => {
            // A bare `-<ts>.json` would glob-match `<anything>-*.json` equally
            // for every session's lookup and defeat the join entirely.
            const name = planFilename("", "2026-08-18T00:00:00.000Z");
            expect(name.startsWith("unknown-")).toBe(true);
        });
    });
});

/**
 * Board-priority cache + rate-limit fallback (issue #2520).
 *
 * `gh project item-list` is a GraphQL call over a 400+-item board, run once
 * per pass, per session — the shared GraphQL budget was gone within the hour
 * with several sessions draining the queue, and the planner's ONLY response
 * to that was a hard stop (`GraphQL: API rate limit exceeded …`).
 *
 * Three distinct outcomes, kept distinct on purpose: fresh cache (reuse, no
 * live call at all), stale-but-present cache used ONLY when the live read
 * fails (announced with its age), and no snapshot at all (the hard stop is
 * unchanged, byte for byte). Conflating "stale" with "absent", or silently
 * using a stale snapshot as if it were fresh, is the failure mode these tests
 * guard against — so every test below asserts the SOURCE tag
 * (`cache-fresh` / `live` / `cache-stale-fallback`), never just the returned
 * priority map, which looks identical across all three.
 */
describe("board priority — isRateLimitError (issue #2520)", () => {
    it("matches the gh CLI's actual GraphQL rate-limit wording", () => {
        expect(
            isRateLimitError(
                "GraphQL: API rate limit exceeded for user ID 117459688."
            )
        ).toBe(true);
    });

    it("does not match an unrelated gh failure — a permission error must still hard-stop", () => {
        expect(
            isRateLimitError(
                "GraphQL: Resource not accessible by personal access token (user.projectV2)"
            )
        ).toBe(false);
    });
});

describe("board priority — isCacheFresh (issue #2520)", () => {
    const NOW = "2026-08-18T12:00:00Z";
    const TTL = 5 * 60 * 1000; // 5 minutes

    it("is fresh inside the TTL", () => {
        expect(isCacheFresh(NOW, "2026-08-18T11:58:00Z", TTL)).toBe(true);
    });

    it("is stale just past the TTL", () => {
        expect(isCacheFresh(NOW, "2026-08-18T11:54:00Z", TTL)).toBe(false);
    });

    it("treats a snapshot from the future (clock skew) as not fresh", () => {
        expect(isCacheFresh(NOW, "2026-08-18T12:05:00Z", TTL)).toBe(false);
    });
});

describe("board priority — formatSnapshotAge (issue #2520)", () => {
    it('matches the exact wording the issue specifies ("3m ago")', () => {
        expect(
            formatSnapshotAge("2026-08-18T12:03:00Z", "2026-08-18T12:00:00Z")
        ).toBe("3m");
    });

    it("floors sub-minute age to a readable label", () => {
        expect(
            formatSnapshotAge("2026-08-18T12:00:30Z", "2026-08-18T12:00:00Z")
        ).toBe("<1m");
    });

    it("switches to hours past 60 minutes", () => {
        expect(
            formatSnapshotAge("2026-08-18T13:05:00Z", "2026-08-18T12:00:00Z")
        ).toBe("1h5m");
        expect(
            formatSnapshotAge("2026-08-18T14:00:00Z", "2026-08-18T12:00:00Z")
        ).toBe("2h");
    });
});

describe("board priority — resolveBoardPriority (issue #2520)", () => {
    const NOW = "2026-08-18T12:05:00Z";
    const TTL = 5 * 60 * 1000;

    function deps(
        overrides: Partial<BoardPriorityDeps> & {
            cache?: BoardPrioritySnapshot;
        }
    ): BoardPriorityDeps & {
        fetchLiveCalls: number;
        writeCalls: BoardPrioritySnapshot[];
    } {
        const writeCalls: BoardPrioritySnapshot[] = [];
        let fetchLiveCalls = 0;
        return {
            now: NOW,
            ttlMs: TTL,
            readCache: () => overrides.cache,
            writeCache: (snapshot) => {
                writeCalls.push(snapshot);
                if (overrides.writeCache) overrides.writeCache(snapshot);
            },
            fetchLive: () => {
                fetchLiveCalls++;
                if (overrides.fetchLive) return overrides.fetchLive();
                return { 10: "P0" };
            },
            get fetchLiveCalls() {
                return fetchLiveCalls;
            },
            writeCalls,
        } as BoardPriorityDeps & {
            fetchLiveCalls: number;
            writeCalls: BoardPrioritySnapshot[];
        };
    }

    it("reuses a fresh cache and makes NO live call at all", () => {
        const d = deps({
            cache: {
                fetchedAt: "2026-08-18T12:02:00Z",
                priority: { 20: "P1" },
            },
        });
        const result = resolveBoardPriority(d);
        expect(result).toEqual({
            priority: { 20: "P1" },
            source: "cache-fresh",
        });
        expect(d.fetchLiveCalls).toBe(0);
    });

    it("re-fetches live when the cache is stale, and writes the new snapshot", () => {
        const d = deps({
            cache: {
                fetchedAt: "2026-08-18T11:00:00Z",
                priority: { 20: "P1" },
            },
        });
        const result = resolveBoardPriority(d);
        expect(result).toEqual({ priority: { 10: "P0" }, source: "live" });
        expect(d.fetchLiveCalls).toBe(1);
        expect(d.writeCalls).toEqual([
            { fetchedAt: NOW, priority: { 10: "P0" } },
        ]);
    });

    it("fetches live when there is no cache at all", () => {
        const d = deps({});
        const result = resolveBoardPriority(d);
        expect(result).toEqual({ priority: { 10: "P0" }, source: "live" });
    });

    it("falls back to a STALE cache on a rate-limit failure, announcing its age", () => {
        // The cache here is well past the TTL — the point of this test is
        // that the TTL governs the SKIP-FETCH decision, not usability as a
        // fallback: a stale snapshot is still enormously better than a stop.
        const d = deps({
            cache: {
                fetchedAt: "2026-08-18T11:00:00Z",
                priority: { 30: "P2" },
            },
            fetchLive: () => {
                throw new Error(
                    "GraphQL: API rate limit exceeded for user ID 117459688."
                );
            },
        });
        const result = resolveBoardPriority(d);
        expect(result).toEqual({
            priority: { 30: "P2" },
            source: "cache-stale-fallback",
            ageLabel: "1h5m",
        });
    });

    it("does NOT fall back on a rate-limit failure with no cache — the hard stop survives", () => {
        const d = deps({
            fetchLive: () => {
                throw new Error(
                    "GraphQL: API rate limit exceeded for user ID 117459688."
                );
            },
        });
        expect(() => resolveBoardPriority(d)).toThrow(/rate limit/i);
    });

    it("does NOT fall back on a NON-rate-limit failure even with a cache present", () => {
        // A permission error is not a rate limit, and a cache is never a
        // substitute for correct access — conflating the two would silently
        // paper over a broken `gh auth` with a snapshot that may be hours old
        // for the wrong reason.
        const d = deps({
            cache: {
                fetchedAt: "2026-08-18T11:00:00Z",
                priority: { 30: "P2" },
            },
            fetchLive: () => {
                throw new Error(
                    "GraphQL: Resource not accessible by personal access token (user.projectV2)"
                );
            },
        });
        expect(() => resolveBoardPriority(d)).toThrow(/not accessible/i);
    });

    it("a cache-write failure does NOT turn a successful live read into a thrown error (issue #2520 round 2)", () => {
        // `deps.writeCache` used to sit inside the same try as `fetchLive`, so
        // an EACCES/ENOSPC from the write — not rate-limit shaped — rethrew
        // and killed a live read that had ALREADY succeeded, with priorities
        // in hand. The caching layer added to prevent hard stops must not
        // itself become a new one.
        const d = deps({
            writeCache: () => {
                throw new Error("EACCES: permission denied");
            },
        });
        const result = resolveBoardPriority(d);
        expect(result).toEqual({ priority: { 10: "P0" }, source: "live" });
    });
});

describe("board priority — readBoardPriorityCache / writeBoardPriorityCache (issue #2520 round 2)", () => {
    function tmpCachePath(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-plan-cache-"));
        return path.join(dir, "board-priority.json");
    }

    it("round-trips a valid snapshot", () => {
        const cachePath = tmpCachePath();
        const snapshot: BoardPrioritySnapshot = {
            fetchedAt: "2026-08-18T12:00:00Z",
            priority: { 10: "P0", 20: "P1" },
        };
        writeBoardPriorityCache(cachePath, snapshot);
        expect(readBoardPriorityCache(cachePath)).toEqual(snapshot);
    });

    it("writes to a temp file and leaves no sibling behind on success", () => {
        const cachePath = tmpCachePath();
        writeBoardPriorityCache(cachePath, {
            fetchedAt: "2026-08-18T12:00:00Z",
            priority: { 10: "P0" },
        });
        const dirEntries = fs.readdirSync(path.dirname(cachePath));
        expect(dirEntries).toEqual(["board-priority.json"]);
    });

    it("a crash between the temp write and the rename leaves the PREVIOUS snapshot intact, not a truncated one", () => {
        // The property the atomic-write fix protects: several loops share this
        // cache file. A bare `writeFileSync` (open O_TRUNC then write) lets a
        // concurrent reader observe a truncated/zero-filled file mid-write —
        // this is fail-safe (a torn file fails JSON.parse and is treated as
        // "no usable snapshot"), but it needlessly turns a recoverable
        // situation into a hard stop. Simulate the crash by making the rename
        // itself throw AFTER the temp file is fully written, and assert the
        // ORIGINAL target file is untouched — proof the write went to a side
        // file the whole time and never opened the target for truncation.
        const cachePath = tmpCachePath();
        const original: BoardPrioritySnapshot = {
            fetchedAt: "2026-08-18T11:00:00Z",
            priority: { 5: "P2" },
        };
        writeBoardPriorityCache(cachePath, original);

        const renameSpy = vi
            .spyOn(nodeFs, "renameSync")
            .mockImplementation(() => {
                throw new Error("simulated crash between write and rename");
            });
        try {
            expect(() =>
                writeBoardPriorityCache(cachePath, {
                    fetchedAt: "2026-08-18T12:00:00Z",
                    priority: { 10: "P0" },
                })
            ).toThrow(/simulated crash/);
        } finally {
            renameSpy.mockRestore();
        }

        // The target file was never touched by the failed write — a BARE
        // `writeFileSync(cachePath, ...)` would have already truncated it by
        // this point, before any "crash" could occur.
        expect(readBoardPriorityCache(cachePath)).toEqual(original);
    });

    it("rejects a snapshot whose fetchedAt does not parse — not just that it is a string", () => {
        const cachePath = tmpCachePath();
        fs.writeFileSync(
            cachePath,
            JSON.stringify({
                fetchedAt: "not-a-date",
                priority: { 10: "P0" },
            })
        );
        // Proof-of-failure: before this guard, an unparseable `fetchedAt`
        // still qualified as a usable snapshot and `formatSnapshotAge` printed
        // "NaNhNaNm ago" for it. Reject the snapshot outright instead.
        expect(readBoardPriorityCache(cachePath)).toBeUndefined();
    });

    it("rejects a snapshot carrying a priority value outside VALID_PRIORITIES", () => {
        const cachePath = tmpCachePath();
        fs.writeFileSync(
            cachePath,
            JSON.stringify({
                fetchedAt: "2026-08-18T12:00:00Z",
                priority: { 10: "P0", 20: "P9" },
            })
        );
        // Proof-of-failure: before this guard, an unranked cached value
        // reached `PRIORITY_RANK[p]` as `undefined` and made the sort
        // comparator return `NaN` — the live path already refuses this via
        // `die()`; the cached path silently let it through.
        expect(readBoardPriorityCache(cachePath)).toBeUndefined();
    });

    it("still returns undefined for a missing file", () => {
        expect(
            readBoardPriorityCache("/nonexistent/path/board-priority.json")
        ).toBeUndefined();
    });
});

describe("board priority — boardPriorityForArgv (issue #2520)", () => {
    const NOW = "2026-08-18T12:05:00Z";
    const TTL = 5 * 60 * 1000;

    function deps(
        overrides: Partial<BoardPriorityDeps> & {
            cache?: BoardPrioritySnapshot;
        }
    ): BoardPriorityDeps {
        return {
            now: NOW,
            ttlMs: TTL,
            readCache: () => overrides.cache,
            writeCache: () => {},
            fetchLive: overrides.fetchLive ?? (() => ({ 10: "P0" })),
        };
    }

    it("--no-priority announces itself, touches neither cache nor live, and returns no priorities", () => {
        const readCache = vi.fn(() => undefined);
        const fetchLive = vi.fn(
            () => ({ 10: "P0" }) as Record<number, BoardPriority>
        );
        const result = boardPriorityForArgv(["--no-priority"], {
            now: NOW,
            ttlMs: TTL,
            readCache,
            writeCache: () => {},
            fetchLive,
        });
        expect(result).toEqual({ priority: {}, message: NO_PRIORITY_MESSAGE });
        expect(readCache).not.toHaveBeenCalled();
        expect(fetchLive).not.toHaveBeenCalled();
    });

    it("a normal live/fresh-cache read carries no message", () => {
        const result = boardPriorityForArgv(
            [],
            deps({ cache: { fetchedAt: NOW, priority: { 20: "P1" } } })
        );
        expect(result).toEqual({ priority: { 20: "P1" } });
        expect(result.message).toBeUndefined();
    });

    it("a rate-limit fallback carries the exact degraded-read announcement", () => {
        // Cache is past the 5-minute TTL, so the fresh-reuse path is not the
        // one under test here — this exercises the OTHER route to the same
        // cache: a live attempt that fails with a rate limit.
        const result = boardPriorityForArgv(
            [],
            deps({
                cache: {
                    fetchedAt: "2026-08-18T11:57:00Z", // 8 minutes before NOW
                    priority: { 30: "P2" },
                },
                fetchLive: () => {
                    throw new Error(
                        "GraphQL: API rate limit exceeded for user ID 117459688."
                    );
                },
            })
        );
        expect(result.priority).toEqual({ 30: "P2" });
        expect(result.message).toBe(rateLimitFallbackMessage("8m"));
        expect(result.message).toBe(
            "⚠ board unread (GraphQL rate limit); using the priority snapshot from 8m ago"
        );
    });
});

describe("board priority — liveFetchBoardPriority (issue #2520)", () => {
    // The seam the rebase onto #2519 created: the READ now lives in
    // `lib/board-priority.ts` and reports every degraded read through
    // `onError`, while the DEGRADE POLICY (fall back to a cached snapshot on a
    // rate limit) still lives here. Wiring `onError: die` straight through —
    // the shape `queue-plan.ts` had before this issue — would exit(2) inside
    // the reader and delete the whole fallback, silently: every test above
    // passes, because they inject `fetchLive` directly and never reach this
    // function.

    it("turns a reader failure into a THROW, so resolveBoardPriority can classify it", () => {
        expect(() =>
            liveFetchBoardPriority((opts) => {
                opts.onError(
                    "cannot read project fil-donadoni/2: GraphQL: API rate limit exceeded for user ID 117459688."
                );
                return {};
            })
        ).toThrow(/rate limit/i);

        // …and the thrown message is one `isRateLimitError` recognizes — the
        // single predicate that decides degrade-vs-hard-stop.
        try {
            liveFetchBoardPriority((opts) => {
                opts.onError(
                    "cannot read project fil-donadoni/2: GraphQL: API rate limit exceeded for user ID 117459688."
                );
                return {};
            });
            expect.unreachable("liveFetchBoardPriority must not return here");
        } catch (err) {
            expect(isRateLimitError((err as Error).message)).toBe(true);
        }
    });

    it("never asks the reader to handle --no-priority — that escape hatch is decided before the read", () => {
        // `boardPriorityForArgv` returns before the cache or the network is
        // touched. Passing `skip` here as well would route the deliberate skip
        // through the throwing `onError` above, which is exactly the shape PR
        // #2545's review found deletes the escape hatch.
        let seen: { skip?: boolean } | undefined;
        liveFetchBoardPriority((opts) => {
            seen = opts;
            return { 10: "P0" };
        });
        expect(seen?.skip).toBeFalsy();
    });

    it("passes a static limit only as the FALLBACK — the reader sizes the window itself", () => {
        let seen: { itemLimit?: number } | undefined;
        const priority = liveFetchBoardPriority((opts) => {
            seen = opts;
            return { 10: "P0" };
        });
        expect(priority).toEqual({ 10: "P0" });
        expect(seen?.itemLimit).toBe(2000);
    });
});
