import { describe, expect, it } from "vitest";
import {
    repairProofCheck,
    repairProofRun,
    runPrCheck,
    type PrCheckContext,
} from "../pr-checks";
import { DERIVED_PATHS } from "../lib/derive-sync";
import type { Lineage } from "../lib/health-verdict-store";

// The PR checks ported from `land` (issue #5639). Each check is the pure
// function `land` already tests; what is pinned here is the wiring — the
// dispatch and the repair proof, whose store and test runner are injected.

const RED_SHA = "a".repeat(40);
const THIS_FILE = "scripts/__tests__/pr-checks.test.ts";

function redLineage(tests: string[] = [THIS_FILE]): Lineage {
    return {
        kind: "red",
        verdict: { sha: RED_SHA, status: "red", tests },
    } as Lineage;
}

/** A runner whose every file exits `code`. */
const exitAll = (code: number) => (t: readonly string[]) => t.map(() => code);

function ctx(over: Partial<PrCheckContext>): PrCheckContext {
    return {
        cwd: process.cwd(),
        prBody: "Closes #900",
        lineage: () => redLineage(),
        repairIssues: () => [900],
        runTests: exitAll(0),
        ...over,
    };
}

describe("robustness-baseline", () => {
    const baseline = [{ label: "Some entry", issue: 4917 }] as never;
    it("refuses a PR closing a row's owner, passes one that does not", () => {
        expect(
            runPrCheck(
                "robustness-baseline",
                ctx({ prBody: "Closes #4917", baseline })
            ).refusal
        ).toContain("Some entry");
        expect(
            runPrCheck(
                "robustness-baseline",
                ctx({ prBody: "Closes #1", baseline })
            ).refusal
        ).toBeNull();
    });
});

describe("repair-proof (issue #5462)", () => {
    it("is red when the RED verdict's failing tests still fail", () => {
        const r = repairProofCheck(ctx({ runTests: exitAll(1) }));
        expect(r.refusal).toContain("still fail");
        expect(r.refusal).toContain(THIS_FILE);
    });

    it("is green when they pass, and runs exactly the verdict's tests", () => {
        let ran: readonly string[] = [];
        const r = repairProofCheck(
            ctx({
                runTests: (t) => {
                    ran = t;
                    return exitAll(0)(t);
                },
            })
        );
        expect(r.refusal).toBeNull();
        expect(ran).toEqual([THIS_FILE]);
    });

    it("owes nothing to a PR that is not a declared repair", () => {
        let ran = false;
        const r = repairProofCheck(
            ctx({
                prBody: "Closes #1",
                runTests: (t) => ((ran = true), exitAll(1)(t)),
            })
        );
        expect(r.refusal).toBeNull();
        expect(ran).toBe(false);
    });

    it("owes nothing when no RED stands", () => {
        const r = repairProofCheck(
            ctx({
                lineage: () => ({ kind: "green", verdict: null }),
                runTests: exitAll(1),
            })
        );
        expect(r.refusal).toBeNull();
    });

    it("skips a test the repair moved, and says it is unproved", () => {
        const r = repairProofCheck(
            ctx({
                lineage: () => redLineage(["scripts/__tests__/gone.test.ts"]),
                runTests: exitAll(1),
            })
        );
        expect(r.refusal).toBeNull();
        expect(r.note).toContain("unproved");
    });

    it("passes WITH a note when the verdict store cannot be read", () => {
        const r = repairProofCheck(
            ctx({
                lineage: () => ({
                    kind: "none",
                    verdict: null,
                    error: "no token",
                }),
                runTests: exitAll(1),
            })
        );
        expect(r.refusal).toBeNull();
        expect(r.note).toContain("not provable here");
    });

    describe("the locked corpus (issue #6563)", () => {
        const CORPUS_TEST = "scripts/__tests__/corpus-exclusion.test.ts";
        const both = () => redLineage([CORPUS_TEST, THIS_FILE]);
        const readsCorpus = (f: string) => f === CORPUS_TEST;

        it("hosted: passes with a note naming the unprovable file, never running it", () => {
            let ran: readonly string[] = [];
            const r = repairProofCheck(
                ctx({
                    lineage: both,
                    corpusExcluded: () => true,
                    readsCorpus,
                    runTests: (t) => {
                        ran = t;
                        return exitAll(0)(t);
                    },
                })
            );
            expect(r.refusal).toBeNull();
            expect(r.note).toContain(CORPUS_TEST);
            expect(r.note).toContain("not provable here");
            expect(ran).toEqual([THIS_FILE]);
        });

        it("hosted: a failing test that does not read the corpus still refuses", () => {
            const r = repairProofCheck(
                ctx({
                    lineage: both,
                    corpusExcluded: () => true,
                    readsCorpus,
                    runTests: exitAll(1),
                })
            );
            expect(r.refusal).toContain(THIS_FILE);
            expect(r.refusal).not.toContain(CORPUS_TEST);
        });

        it("hosted: only corpus tests means a note and no run at all", () => {
            let ran = false;
            const r = repairProofCheck(
                ctx({
                    lineage: () => redLineage([CORPUS_TEST]),
                    corpusExcluded: () => true,
                    readsCorpus,
                    runTests: (t) => ((ran = true), exitAll(1)(t)),
                })
            );
            expect(r.refusal).toBeNull();
            expect(r.note).toContain(CORPUS_TEST);
            expect(ran).toBe(false);
        });

        it("with the key: a corpus test that still fails refuses", () => {
            const r = repairProofCheck(
                ctx({
                    lineage: both,
                    corpusExcluded: () => false,
                    readsCorpus,
                    runTests: exitAll(1),
                })
            );
            expect(r.refusal).toContain(CORPUS_TEST);
        });
    });
});

// Issue #7448: RED @ 6491254e had two culprits (PR #7401, PR #7396), each
// reverted by its own repair; the proof demanded each revert turn BOTH failing
// tests green, so neither could land first.
describe("repair-proof of a two-culprit RED (issue #7448)", () => {
    const OTHER = "scripts/__tests__/land.test.ts";
    const twoCulprits = () => redLineage([THIS_FILE, OTHER]);
    /** A repair whose diff turns `share` green and leaves the rest red. */
    const repairing =
        (share: string) =>
        (t: readonly string[]): number[] =>
            t.map((f) => (f === share ? 0 : 1));

    it("each repair passes on its own share, naming the other culprit's still red", () => {
        for (const [share, other] of [
            [THIS_FILE, OTHER],
            [OTHER, THIS_FILE],
        ]) {
            const r = repairProofCheck(
                ctx({ lineage: twoCulprits, runTests: repairing(share) })
            );
            expect(r.refusal).toBeNull();
            expect(r.note).toContain(`still red: ${other}`);
        }
    });

    it("a repair that turns none of them green still refuses", () => {
        const r = repairProofCheck(
            ctx({ lineage: twoCulprits, runTests: exitAll(1) })
        );
        expect(r.refusal).toContain("still fail");
    });

    it("a repair of the whole RED passes with no note", () => {
        const r = repairProofCheck(
            ctx({ lineage: twoCulprits, runTests: exitAll(0) })
        );
        expect(r).toEqual({ refusal: null });
    });
});

// Issue #7489: a PR stops carrying the derived state (ADR 0157), so a revert
// of a hand-written card left the Definition Index naming it and the proof
// crashed on a stale index instead of running the RED's test.
describe("repair-proof's run rebuilds the derived state (issue #7489)", () => {
    const RESTORE = ["git", "checkout", "-q", "HEAD", "--", ...DERIVED_PATHS];

    function record(codes: Record<string, number> = {}) {
        const calls: string[][] = [];
        const exec = (argv: readonly string[]) => {
            calls.push([...argv]);
            return codes[argv[1]] ?? 0;
        };
        return { calls, exec };
    }

    it("regenerates, runs the tests, then restores the derived paths", () => {
        const { calls, exec } = record();
        expect(repairProofRun([THIS_FILE], "/wt", exec)).toEqual([0]);
        expect(calls).toEqual([
            ["bun", "run", "derive:regenerate"],
            ["bunx", "vitest", "run", THIS_FILE],
            RESTORE,
        ]);
    });

    it("runs one vitest per file, regenerating once (issue #7448)", () => {
        const { calls, exec } = record();
        expect(repairProofRun(["a.test.ts", "b.test.ts"], "/wt", exec)).toEqual(
            [0, 0]
        );
        expect(calls).toEqual([
            ["bun", "run", "derive:regenerate"],
            ["bunx", "vitest", "run", "a.test.ts"],
            ["bunx", "vitest", "run", "b.test.ts"],
            RESTORE,
        ]);
    });

    it("restores the derived paths on a red run too", () => {
        const { calls, exec } = record({ vitest: 1 });
        expect(repairProofRun([THIS_FILE], "/wt", exec)).toEqual([1]);
        expect(calls.at(-1)).toEqual(RESTORE);
    });

    it("is red without running the tests when the tree cannot be rebuilt", () => {
        const { calls, exec } = record({ run: 2 });
        expect(repairProofRun([THIS_FILE], "/wt", exec)).toEqual([2]);
        expect(calls).toEqual([["bun", "run", "derive:regenerate"], RESTORE]);
    });
});
