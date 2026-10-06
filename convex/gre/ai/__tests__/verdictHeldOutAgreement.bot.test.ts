// Held-out agreement (issue #3982, PRD #3980): eval and pick agreement are
// measured on the held-out side of the split ONLY, per Decision Class, each
// with its `n` and an `indicative` flag under 100. The golden below pins the
// printed numbers on a small hand-built corpus; the side is the REAL split
// (`verdictSideOf`), found by scanning boards, never a stubbed one.
import { describe, expect, it } from "vitest";
import {
    INDICATIVE_BELOW,
    formatHeldOutEvalAgreement,
    formatHeldOutPickAgreement,
    heldOutEvalAgreement,
    heldOutVerdicts,
    searchHeldOutVerdicts,
    verdictSideOf,
    type EvalPair,
    type Verdict,
    type VerdictSearchRow,
} from "../verdicts";

const NO_TEST_POSITIONS: ReadonlySet<string> = new Set();

const KEYS = {
    cast: '{"kind":"cast-spell"}',
    pass: '{"kind":"pass"}',
} as const;

/** The `n`-th board (scanning turns) on `side`, judged `cls`. */
function verdictOn(
    side: "fit" | "held-out",
    cls: keyof typeof KEYS,
    n: number
): Verdict {
    let seen = 0;
    for (let turn = 1; turn < 5000; turn++) {
        const v: Verdict = {
            id: `${side}:${cls}:${n}`,
            spec: {
                cards: [],
                phase: "PRECOMBAT_MAIN",
                turn,
                life: { me: 20, opp: 7 },
            },
            seat: "me",
            candidates: [
                { key: '{"kind":"attack"}', description: "other" },
                { key: KEYS[cls], description: cls },
            ],
            answer: { kind: "right", rightIndexes: [1] },
            author: "dev:t",
            createdAt: "2026-10-05T10:00:00.000Z",
            source: "authored",
        };
        // Distinct boards per (side, cls, n): the turn scan is shared, so the
        // verdict is taken from a per-call counter over matching turns.
        if (
            verdictSideOf(v, NO_TEST_POSITIONS) === side &&
            seen++ === n + OFFSET[cls]
        )
            return v;
    }
    throw new Error(`no ${side} board`);
}
const OFFSET = { cast: 0, pass: 400 } as const;

const pair = (verdictId: string, delta: number): EvalPair =>
    ({ verdictId, delta }) as EvalPair;

describe("held-out eval agreement (issue #3982)", () => {
    const heldCast = [0, 1, 2].map((n) => verdictOn("held-out", "cast", n));
    const heldPass = [0, 1].map((n) => verdictOn("held-out", "pass", n));
    const fitCast = verdictOn("fit", "cast", 0);
    const verdicts = [...heldCast, ...heldPass, fitCast];
    const report = {
        pairs: [
            pair(heldCast[0].id, 120),
            pair(heldCast[1].id, 5),
            pair(heldCast[2].id, -40),
            pair(heldPass[0].id, 80),
            pair(heldPass[1].id, 0), // a tie is not agreement
            pair(fitCast.id, -999), // fit side: never read
        ],
        timing: [pair(heldPass[0].id, 3), pair(fitCast.id, 3)],
        incomplete: [
            { verdictId: heldCast[0].id, why: "half" },
            { verdictId: fitCast.id, why: "half" },
        ],
    };

    it("tallies held-out pairs only, per class, with timing and incomplete counted apart", () => {
        const text = formatHeldOutEvalAgreement(
            heldOutEvalAgreement(report, verdicts, NO_TEST_POSITIONS)
        );
        expect(text).toBe(
            [
                "== held-out eval agreement (issue #3982) — pairs the Evaluation orders as the player did, held-out side only",
                "  burned             : 0 held-out positions admitted to the registry anyway (held-out n = 5 remaining)",
                "  all                : 3/5 (60.0%)  n = 5, indicative, not a claim",
                "  excluded           : 1 timing pairs, 1 incomplete units (not agreement evidence)",
                "  by Decision Class",
                "    cast             : 2/3 (66.7%)  n = 3, indicative, not a claim",
                "    pass             : 1/2 (50.0%)  n = 2, indicative, not a claim",
            ].join("\n")
        );
    });

    it("drops the indicative flag at n = INDICATIVE_BELOW", () => {
        const many = Array.from({ length: INDICATIVE_BELOW }, (_, n) =>
            verdictOn("held-out", "cast", n)
        );
        const text = formatHeldOutEvalAgreement(
            heldOutEvalAgreement(
                {
                    pairs: many.map((v) => pair(v.id, 10)),
                    timing: [],
                    incomplete: [],
                },
                many,
                NO_TEST_POSITIONS
            )
        );
        expect(text).toContain(
            "all                : 100/100 (100.0%)  n = 100\n"
        );
        expect(text).not.toContain("indicative");
    });
});

describe("held-out pick agreement (issue #3982)", () => {
    it("never searches a fit-side verdict", () => {
        const held = verdictOn("held-out", "cast", 0);
        const fit = verdictOn("fit", "cast", 0);
        const searched: string[] = [];
        const rows = searchHeldOutVerdicts(
            [held, fit],
            NO_TEST_POSITIONS,
            () => ({ iterations: 1, seeds: [0] }),
            (v) => {
                searched.push(v.id);
                return {
                    verdictId: v.id,
                    class: "cast",
                    timing: false,
                    agreed: 1,
                    seeds: 1,
                    picks: [],
                };
            }
        );
        expect(searched).toEqual([held.id]);
        expect(rows.map((r) => r.verdictId)).toEqual([held.id]);
        expect(heldOutVerdicts([held, fit], NO_TEST_POSITIONS)).toEqual([held]);
    });

    it("prints aggregate, timing and per-class rows with n and the indicative flag", () => {
        const row = (
            id: string,
            cls: string,
            timing: boolean,
            agreed: number
        ): VerdictSearchRow => ({
            verdictId: id,
            class: cls,
            timing,
            agreed,
            seeds: 2,
            picks: [],
        });
        const text = formatHeldOutPickAgreement(
            [
                row("a", "cast", false, 2),
                row("b", "cast", false, 1),
                row("c", "pass", true, 2),
                { ...row("d", "pass", false, 0), error: "no rebuild" },
            ],
            "400 iterations",
            { burned: 2, heldOutN: 4 }
        );
        expect(text).toBe(
            [
                "== held-out pick agreement (issue #3982) — verdicts whose every seed picked an allowed candidate, held-out side only, 400 iterations",
                "  burned             : 2 held-out positions admitted to the registry anyway (held-out n = 4 remaining)",
                "  all                : 2/3 (66.7%)  n = 3, indicative, not a claim  [seeds 5/6]",
                "  timing             : 1/1 (100.0%)  n = 1, indicative, not a claim  [seeds 2/2]",
                "  everything else    : 1/2 (50.0%)  n = 2, indicative, not a claim  [seeds 3/4]",
                "  unsearchable       : 1 verdicts (errors, not agreement evidence)",
                "  by Decision Class",
                "    cast             : 1/2 (50.0%)  n = 2, indicative, not a claim  [seeds 3/4]",
                "    pass             : 1/1 (100.0%)  n = 1, indicative, not a claim  [seeds 2/2]",
            ].join("\n")
        );
    });
});
