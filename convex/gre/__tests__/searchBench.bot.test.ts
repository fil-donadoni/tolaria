// Feasibility benchmark (ADR 0001, issue #108). Runs the clone + truncated
// dummy rollout loop and reports iterations/sec, plus the structuredClone
// baseline so the structural-sharing speedup is visible. CI-safe: asserts only
// that the harness runs and produces positive throughput — NOT a hard perf
// threshold (which would be flaky across machines). The measured numbers are
// recorded in docs/vs-ai/0001-feasibility-benchmark.md.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    runCloneRolloutBenchmark,
    representativeBenchState,
} from "../searchBench";
import { cloneGameState } from "../clone";

const BEARS = getCardByName("Grizzly Bears").id;
// Keep the loop short so it adds little to the suite; long enough to be stable.
const BUDGET_MS = 250;

describe("vs-AI feasibility benchmark (issue #108)", () => {
    it("reports clone + truncated-rollout iterations/sec", () => {
        const result = runCloneRolloutBenchmark({
            creatureCardId: BEARS,
            budgetMs: BUDGET_MS,
            rolloutDepth: 10,
            label: "cloneGameState",
        });

        console.log(
            `[bench] cloneGameState: ${result.iterPerSec.toLocaleString()} iter/sec ` +
                `(${result.iterations} iters / ${Math.round(result.ms)}ms, depth ${result.rolloutDepth})`
        );

        expect(result.iterations).toBeGreaterThan(0);
        expect(result.iterPerSec).toBeGreaterThan(0);
    });

    it("quantifies the structural-sharing speedup vs structuredClone", () => {
        const shared = runCloneRolloutBenchmark({
            creatureCardId: BEARS,
            budgetMs: BUDGET_MS,
            clone: cloneGameState,
            label: "cloneGameState",
        });
        const baseline = runCloneRolloutBenchmark({
            creatureCardId: BEARS,
            budgetMs: BUDGET_MS,
            clone: (s) => structuredClone(s),
            label: "structuredClone",
        });

        const speedup = shared.iterPerSec / baseline.iterPerSec;
        console.log(
            `[bench] structuredClone: ${baseline.iterPerSec.toLocaleString()} iter/sec | ` +
                `cloneGameState: ${shared.iterPerSec.toLocaleString()} iter/sec | ` +
                `speedup ${speedup.toFixed(2)}x`
        );

        expect(baseline.iterPerSec).toBeGreaterThan(0);
        // Structural sharing must not be slower than the general-purpose clone.
        expect(shared.iterPerSec).toBeGreaterThanOrEqual(
            baseline.iterPerSec * 0.9
        );
    });

    it("builds a representative, non-trivial bench position", () => {
        const state = representativeBenchState(BEARS);
        const cardCount = state.players.reduce(
            (n, p) =>
                n +
                p.hand.length +
                p.library.length +
                p.graveyard.length +
                p.battlefield.length,
            0
        );
        // ~88 instances across both players — realistic clone surface.
        expect(cardCount).toBeGreaterThan(60);
    });
});
