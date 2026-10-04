// The held-out split (issue #3981, PRD #3980, ADR 0138): which side of the
// Verdict corpus the Weight Fit may read.
//
// Every claim is a property of the SIDE a Verdict resolves to: it is a
// function of the scenario alone (deterministic, stable under a growing
// corpus, blind to the answer and the candidate spelling), one in
// `HELD_OUT_SPLIT_MODULUS` lands held-out, a Test Position overrides the hash,
// and the fit's input never carries a held-out pair. The golden pin at the
// bottom is what makes "the same scenario always resolves to the same side"
// true across builds, not only within one run.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/registry";
import {
    HELD_OUT_SPLIT_MODULUS,
    fitInputPairs,
    heldOutBucketOf,
    positionKeyOf,
    scenarioKeyOf,
    testPositionKeysOf,
    verdictSideOf,
    verdictsFromRegistry,
    type EvalPair,
    type Verdict,
} from "../verdicts";

const BASE: Verdict = {
    id: "in-play:k17abc",
    spec: {
        cards: [],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        life: { me: 20, opp: 7 },
    },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [1] },
    author: "dev:user123",
    createdAt: "2026-09-15T10:00:00.000Z",
    source: "in-play",
};

const NO_TEST_POSITIONS: ReadonlySet<string> = new Set();

/** `BASE` on another board: one scenario per `(turn, oppLife)`. */
const atBoard = (turn: number, opp: number, id = `v:${turn}:${opp}`) => ({
    ...BASE,
    id,
    spec: { ...BASE.spec, turn, life: { me: 20, opp } },
});

/** The first board, scanning turns, whose verdict resolves to `side` with no
 *  Test Position protecting it. */
function boardOnSide(side: "fit" | "held-out"): Verdict {
    for (let turn = 1; turn < 500; turn++) {
        const v = atBoard(turn, 7);
        if (verdictSideOf(v, NO_TEST_POSITIONS) === side) return v;
    }
    throw new Error(`no board resolves ${side} in 500 turns`);
}

/** A pair of `verdictId`, the only field the narrowing reads. */
const pairOf = (verdictId: string): EvalPair =>
    ({ verdictId, kind: "right" }) as EvalPair;

describe("the held-out split is a function of the scenario (issue #3981)", () => {
    it("holds out one scenario in HELD_OUT_SPLIT_MODULUS", () => {
        expect(HELD_OUT_SPLIT_MODULUS).toBe(5);
        const boards = Array.from({ length: 2000 }, (_, i) =>
            atBoard(1 + (i % 40), 1 + Math.floor(i / 40))
        );
        const heldOut = boards.filter(
            (v) => verdictSideOf(v, NO_TEST_POSITIONS) === "held-out"
        ).length;
        // 2000 draws at p = 0.2: σ ≈ 17.9, so ±90 is five sigma.
        expect(heldOut).toBeGreaterThan(400 - 90);
        expect(heldOut).toBeLessThan(400 + 90);
    });

    it("never reads the answer, the classification, the candidates or the provenance", () => {
        for (const side of ["fit", "held-out"] as const) {
            const v = boardOnSide(side);
            const variants: Verdict[] = [
                { ...v, answer: { kind: "forbidden", forbiddenIndexes: [0] } },
                { ...v, classification: { kind: "absolute" } },
                {
                    ...v,
                    candidates: [
                        ...v.candidates,
                        { key: '{"kind":"attack"}', description: "attack" },
                    ],
                },
                {
                    ...v,
                    id: "authored:other",
                    author: "dev:someone",
                    source: "authored",
                },
            ];
            for (const w of variants) {
                expect(verdictSideOf(w, NO_TEST_POSITIONS)).toBe(side);
            }
            // The position key DOES read the candidates — which is why the
            // split is keyed on the scenario instead.
            expect(positionKeyOf(variants[2])).not.toBe(positionKeyOf(v));
            expect(scenarioKeyOf(variants[2])).toBe(scenarioKeyOf(v));
        }
    });

    it("is stable: a growing corpus never moves an existing verdict's side", () => {
        const corpus = Array.from({ length: 50 }, (_, i) => atBoard(1 + i, 7));
        const pairs = corpus.map((v) => pairOf(v.id));
        const alone = fitInputPairs(pairs, corpus, NO_TEST_POSITIONS).map(
            (p) => p.verdictId
        );
        const grown = [
            ...Array.from({ length: 200 }, (_, i) => atBoard(1 + i, 3)),
            ...corpus,
        ];
        expect(
            fitInputPairs(pairs, grown, NO_TEST_POSITIONS).map(
                (p) => p.verdictId
            )
        ).toEqual(alone);
        // …and the corpus split for real: both sides are populated.
        expect(alone.length).toBeGreaterThan(0);
        expect(alone.length).toBeLessThan(corpus.length);
    });

    it("is deterministic across builds — the golden pin", () => {
        // Derived OUTSIDE this module: sha256 of the canonical text
        // {"seat":"me","spec":{"cards":[],"life":{"me":20,"opp":7},"phase":"PRECOMBAT_MAIN","turn":3}}
        // (node:crypto), and 0x9aa0f7cb mod 5 = 4. Moving either is a
        // reshuffle of the held-out side: every agreement number measured
        // before it is on a different sample.
        expect(scenarioKeyOf(BASE)).toBe(
            "v1-9aa0f7cb540985aaef52e275bb2a4823d53e1548267f39c97365562bf9a0f5b7"
        );
        expect(heldOutBucketOf(scenarioKeyOf(BASE))).toBe(4);
        expect(verdictSideOf(BASE, NO_TEST_POSITIONS)).toBe("fit");
    });

    it("refuses a key that is not a v1 digest", () => {
        expect(() => heldOutBucketOf("v2-00000000")).toThrow(/scenario key/);
        expect(() => heldOutBucketOf("v1-zz")).toThrow(/scenario key/);
        expect(() => heldOutBucketOf(scenarioKeyOf(BASE), 1)).toThrow(
            /modulus/
        );
    });
});

describe("a Test Position is fit-side by rule, never by hash (issue #3981)", () => {
    const testPositions = testPositionKeysOf(BLADE_SCENARIOS);
    const registry = verdictsFromRegistry(BLADE_SCENARIOS).verdicts;
    const heldOutByHash = registry.filter(
        (v) => heldOutBucketOf(scenarioKeyOf(v)) === 0
    );

    it("the registry has entries the hash alone would hold out", () => {
        expect(heldOutByHash.length).toBeGreaterThan(0);
    });

    it("every registry verdict resolves fit-side", () => {
        for (const v of registry) {
            expect(verdictSideOf(v, testPositions), v.id).toBe("fit");
        }
    });

    it("so does a store verdict about a registry entry's scenario", () => {
        for (const v of heldOutByHash) {
            const storeTwin: Verdict = {
                ...v,
                id: `in-play:${v.id}`,
                source: "in-play",
                author: "dev:tester",
            };
            expect(verdictSideOf(storeTwin, NO_TEST_POSITIONS)).toBe(
                "held-out"
            );
            expect(verdictSideOf(storeTwin, testPositions), v.id).toBe("fit");
        }
    });
});

describe("the Weight Fit's input never carries a held-out pair (issue #3981)", () => {
    const fit = boardOnSide("fit");
    const heldOut = boardOnSide("held-out");

    it("drops every pair of a held-out verdict and keeps the fit side's", () => {
        const pairs = [
            pairOf(fit.id),
            pairOf(heldOut.id),
            pairOf(fit.id),
            pairOf(heldOut.id),
        ];
        const input = fitInputPairs(pairs, [fit, heldOut], NO_TEST_POSITIONS);
        expect(input.map((p) => p.verdictId)).toEqual([fit.id, fit.id]);
    });

    it("refuses a pair whose verdict is not in the corpus", () => {
        expect(() =>
            fitInputPairs([pairOf("ghost")], [fit], NO_TEST_POSITIONS)
        ).toThrow(/ghost.*not in the corpus/);
    });
});
