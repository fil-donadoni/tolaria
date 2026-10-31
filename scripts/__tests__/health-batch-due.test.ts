// ADR 0159 § 4 (issue #6990): the batch health gate is dispatched by event —
// a batch of landings with no verdict — beside the cron (health-early's
// `classify`).
import { describe, expect, it } from "vitest";
import {
    LANDINGS_PER_BATCH,
    batchDue,
    LADDER_RUN_TITLE,
    healthGateRunsPending,
    healthRunsPending,
    landingsIn,
    pushOwesBatchRun,
    pushOwesRedRegate,
    redTipOwesGate,
    subjectsBetween,
} from "../lib/health-batch-due";

const landing = (n: number) => `fix: something (#${n})`;

describe("landingsIn — a landing is a commit the queue merged", () => {
    it("counts the ` (#N)` subjects and nothing else — a derive or sync commit is not a landing", () => {
        expect(
            landingsIn([
                landing(1),
                "derive:sync — regenerate the lockfile header and data/catalogue on the tip",
                "bot-replay — replay the Bot-play sweep on the base's tip",
                "gaps:sync — allowlist",
                landing(2),
                "  pr-refresh: rebase (#3)  ",
            ])
        ).toBe(3);
        expect(landingsIn([])).toBe(0);
    });
});

describe("batchDue — the decision", () => {
    it("is due at the batch with no run in flight, not before, never while a run is in flight", () => {
        expect(
            batchDue({
                landingsSinceVerdict: LANDINGS_PER_BATCH,
                inFlight: false,
            })
        ).toBe(true);
        expect(
            batchDue({
                landingsSinceVerdict: LANDINGS_PER_BATCH + 7,
                inFlight: false,
            })
        ).toBe(true);
        expect(
            batchDue({
                landingsSinceVerdict: LANDINGS_PER_BATCH - 1,
                inFlight: false,
            })
        ).toBe(false);
        expect(
            batchDue({
                landingsSinceVerdict: LANDINGS_PER_BATCH,
                inFlight: true,
            })
        ).toBe(false);
        expect(
            batchDue({ landingsSinceVerdict: 2, inFlight: false, perBatch: 2 })
        ).toBe(true);
    });
});

describe("pushOwesBatchRun — the newest verdict's sha to the pushed tip, total", () => {
    const sha = "b".repeat(40);
    const subjectsOf = (n: number) => () =>
        Array.from({ length: n }, (_, i) => landing(i + 1));

    it("due once a batch of landings separates the pushed tip from the newest verdict", () => {
        const asked: [string, string][] = [];
        expect(
            pushOwesBatchRun("/x", sha, {
                latestVerdictSha: () => "a".repeat(40),
                subjects: (f, t) => {
                    asked.push([f, t]);
                    return subjectsOf(LANDINGS_PER_BATCH)();
                },
                inFlight: () => false,
            })
        ).toBe(true);
        expect(asked).toEqual([["a".repeat(40), sha]]);
        expect(
            pushOwesBatchRun("/x", sha, {
                latestVerdictSha: () => "a".repeat(40),
                subjects: subjectsOf(LANDINGS_PER_BATCH - 1),
                inFlight: () => false,
            })
        ).toBe(false);
    });

    it("no verdict in the history the store reads is a batch owed; a run in flight holds it", () => {
        expect(
            pushOwesBatchRun("/x", sha, {
                latestVerdictSha: () => null,
                subjects: () => {
                    throw new Error("not asked");
                },
                inFlight: () => false,
            })
        ).toBe(true);
        expect(
            pushOwesBatchRun("/x", sha, {
                latestVerdictSha: () => null,
                inFlight: () => true,
            })
        ).toBe(false);
    });

    it("an unreadable fact answers not due — the cron's turn", () => {
        expect(
            pushOwesBatchRun("/x", sha, {
                latestVerdictSha: () => {
                    throw new Error("store down");
                },
            })
        ).toBe(false);
        expect(
            pushOwesBatchRun("/x", sha, {
                latestVerdictSha: () => "a".repeat(40),
                subjects: () => {
                    throw new Error("gh down");
                },
                inFlight: () => false,
            })
        ).toBe(false);
    });
});

describe("healthRunsPending — a dispatched gate not yet past its setup holds the next dispatch", () => {
    it("asks for queued and in-progress health.yml runs, true on either", () => {
        const seen: string[] = [];
        const none = (args: string[]) => {
            seen.push(args[args.indexOf("--status") + 1]!);
            return "[]";
        };
        expect(healthRunsPending(none)).toBe(false);
        expect(seen).toEqual(["queued", "in_progress"]);
        expect(
            healthRunsPending((args) =>
                args.includes("in_progress") ? '[{"databaseId":1}]' : "[]"
            )
        ).toBe(true);
        expect(healthRunsPending(() => '[{"databaseId":2}]')).toBe(true);
    });
});

describe("subjectsBetween — the compare endpoint's first lines", () => {
    it("asks gh for the commits between the two shas and keeps each subject", () => {
        process.env.GH_REPO = "o/r";
        const calls: string[][] = [];
        const run = (args: string[]) => {
            calls.push(args);
            return `${landing(1)}\nderive:sync — x\n\n${landing(2)}\n`;
        };
        expect(subjectsBetween("/x", "aaa", "bbb", run)).toEqual([
            landing(1),
            "derive:sync — x",
            landing(2),
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[1]).toBe("repos/o/r/compare/aaa...bbb");
    });
});

// Issue #7647: a standing RED with an unverdicted pushed tip dispatches the
// gate at once — a revert is GREEN in minutes, not at the next cron.
describe("redTipOwesGate — the third classify predicate", () => {
    it("RED standing + tip unverdicted + no run in flight → dispatch", () => {
        for (const lineage of ["red", "second-red"] as const)
            expect(
                redTipOwesGate({ lineage, tipStatus: null, inFlight: false })
            ).toBe(true);
    });
    it("GREEN (or any non-blocking) lineage → no dispatch", () => {
        for (const lineage of ["green", "amber", "infra", "none"] as const)
            expect(
                redTipOwesGate({ lineage, tipStatus: null, inFlight: false })
            ).toBe(false);
    });
    it("a gate in flight → no dispatch", () => {
        expect(
            redTipOwesGate({ lineage: "red", tipStatus: null, inFlight: true })
        ).toBe(false);
    });
    it("INFRA on the tip proves nothing → dispatch; a settled tip verdict → no dispatch", () => {
        expect(
            redTipOwesGate({
                lineage: "red",
                tipStatus: "infra",
                inFlight: false,
            })
        ).toBe(true);
        for (const tipStatus of ["green", "red", "amber"])
            expect(
                redTipOwesGate({ lineage: "red", tipStatus, inFlight: false })
            ).toBe(false);
    });
});

describe("pushOwesRedRegate — total", () => {
    const SHA = "e".repeat(40);
    it("reads the lineage, the tip's own verdict and the in-flight probe", () => {
        const asked: string[] = [];
        expect(
            pushOwesRedRegate("/tmp", SHA, {
                lineage: () => "red",
                tipStatus: (s) => {
                    asked.push(s);
                    return null;
                },
                inFlight: () => false,
            })
        ).toBe(true);
        expect(asked).toEqual([SHA]);
    });
    it("an unreadable fact answers no re-gate — the cron's turn", () => {
        expect(
            pushOwesRedRegate("/tmp", SHA, {
                lineage: () => "red",
                tipStatus: () => {
                    throw new Error("store down");
                },
                inFlight: () => false,
            })
        ).toBe(false);
    });
});

describe("healthGateRunsPending — only a GATE in flight holds the re-gate (issue #7647)", () => {
    const lists = (queued: string[], running: string[]) => (args: string[]) =>
        JSON.stringify(
            (args.includes("queued") ? queued : running).map((t) => ({
                displayTitle: t,
            }))
        );
    it("a ladder run, queued or running, is not a gate in flight", () => {
        expect(
            healthGateRunsPending(lists([LADDER_RUN_TITLE], [LADDER_RUN_TITLE]))
        ).toBe(false);
        expect(healthGateRunsPending(lists([], []))).toBe(false);
    });
    it("a gate run — or a run older than the run-name — is", () => {
        expect(
            healthGateRunsPending(lists([], [LADDER_RUN_TITLE, "health gate"]))
        ).toBe(true);
        expect(healthGateRunsPending(lists(["health"], []))).toBe(true);
    });
});
