import { describe, it, expect } from "vitest";
import { evaluateBreakdown } from "@convex/gre/evaluate";
import {
    makePlayer,
    makeState,
} from "../../../../convex/cards/__tests__/setup";
import { EVAL_TERM_LABELS, EVAL_TERM_ORDER } from "../eval-term-labels";

/**
 * The debug UI's eval-term label table, guarded against the drift that shipped
 * with issue #2686: `manaDevelopment` was added to `EvalTerms` and BOTH display
 * sites (the trace line and its legend) kept their own hand-maintained lists,
 * so the term rendered nowhere and the self/opp line stopped summing to the Δ
 * printed beside it.
 *
 * `EVAL_TERM_LABELS` is a `Record<keyof EvalTerms, …>`, so the primary guard is
 * `tsc`. This is its runtime twin: it walks a REAL `evaluateBreakdown` result,
 * so a term that exists at runtime but not in the table (or the reverse) fails
 * here even if the type ever loosens.
 */
describe("eval-term labels (issue #2686 drift guard)", () => {
    it("labels exactly the terms a real evaluateBreakdown produces", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const live = Object.keys(evaluateBreakdown(state, "p1").self).sort();
        expect([...EVAL_TERM_ORDER].sort()).toEqual(live);
    });

    it("gives every term a unique, non-empty glyph and name", () => {
        const shorts = EVAL_TERM_ORDER.map((k) => EVAL_TERM_LABELS[k].short);
        expect(shorts.every((s) => s.length > 0)).toBe(true);
        expect(new Set(shorts).size).toBe(shorts.length);
        expect(
            EVAL_TERM_ORDER.every((k) => EVAL_TERM_LABELS[k].name.length > 0)
        ).toBe(true);
    });
});
