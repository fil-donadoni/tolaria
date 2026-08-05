import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    planBatch,
    pathsOverlap,
    normalizePath,
    isAppendOnlyPath,
    EVERYTHING,
    type BatchPlan,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "../lib/queue-plan";

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
    openPr: number[] = []
): QueuePort & { calls: number[] } {
    const calls: number[] = [];
    return {
        calls,
        issuesWithOpenPr: openPr,
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
