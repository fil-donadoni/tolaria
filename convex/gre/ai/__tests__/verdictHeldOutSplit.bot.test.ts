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
import type { BladeScenario } from "../blade/types";
import {
    HELD_OUT_SPLIT_MODULUS,
    burnedCountOf,
    burnedOf,
    fitInputPairs,
    heldOutBucketOf,
    minimalPairStandings,
    pairSplitRefusals,
    positionKeyOf,
    scenarioKeyOf,
    improvesOnIncumbent,
    scoreVerdictReport,
    sideReportOf,
    testPositionKeysOf,
    verdictIdOf,
    verdictSideOf,
    verdictSidesOf,
    verdictsFromRegistry,
    type EvalPair,
    type Verdict,
    type VerdictReport,
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

    it("every registry verdict resolves fit-side, by its source alone", () => {
        for (const v of registry) {
            expect(verdictSideOf(v, NO_TEST_POSITIONS), v.id).toBe("fit");
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

describe("a Minimal Pair falls on one side, as one unit (issue #3981, ADR 0148)", () => {
    const DISCRIMINANT = {
        kind: "other",
        detail: "the opponent is tapped out",
    } as const;
    /** A Conditional anchor and its right-hand half, on the two boards. */
    const unit = (anchorBoard: Verdict, halfBoard: Verdict) => {
        const anchor: Verdict = {
            ...anchorBoard,
            id: "anchor",
            answer: { kind: "forbidden", forbiddenIndexes: [1] },
            classification: { kind: "conditional", discriminant: DISCRIMINANT },
        };
        const half: Verdict = {
            ...halfBoard,
            id: "half",
            answer: { kind: "right", rightIndexes: [1] },
            pairOf: {
                anchorId: verdictIdOf(anchor),
                discriminant: DISCRIMINANT,
            },
        };
        return { anchor, half };
    };
    const fitBoard = boardOnSide("fit");
    const heldOutBoard = boardOnSide("held-out");

    it("takes its anchor's side, whichever bucket the half's own board is in", () => {
        for (const [a, h, side] of [
            [heldOutBoard, fitBoard, "held-out"],
            [fitBoard, heldOutBoard, "fit"],
        ] as const) {
            const { anchor, half } = unit(a, h);
            // The half alone would hash to the other side…
            expect(verdictSideOf(half, NO_TEST_POSITIONS)).not.toBe(side);
            // …and the unit puts it beside its anchor, in either corpus order.
            for (const corpus of [
                [anchor, half],
                [half, anchor],
            ]) {
                const sides = verdictSidesOf(corpus, NO_TEST_POSITIONS);
                expect(sides.get("anchor")).toBe(side);
                expect(sides.get("half")).toBe(side);
                expect(
                    fitInputPairs(
                        [pairOf("anchor"), pairOf("half")],
                        corpus,
                        NO_TEST_POSITIONS
                    ).length
                ).toBe(side === "fit" ? 2 : 0);
            }
        }
    });

    it("is fit-side when either member is a Test Position", () => {
        const { anchor, half } = unit(heldOutBoard, fitBoard);
        const registryHalf: Verdict = { ...half, source: "registry" };
        expect(
            verdictSidesOf([anchor, registryHalf], NO_TEST_POSITIONS).get(
                "anchor"
            )
        ).toBe("fit");
        const registryAnchor: Verdict = { ...anchor, source: "registry" };
        const storeHalf: Verdict = {
            ...unit(heldOutBoard, heldOutBoard).half,
            pairOf: {
                anchorId: verdictIdOf(registryAnchor),
                discriminant: DISCRIMINANT,
            },
        };
        expect(
            verdictSidesOf([registryAnchor, storeHalf], NO_TEST_POSITIONS).get(
                "half"
            )
        ).toBe("fit");
    });

    it("leaves a half without its anchor of unknown side — its pair is refused", () => {
        const { half } = unit(fitBoard, fitBoard);
        expect(verdictSidesOf([half], NO_TEST_POSITIONS).has("half")).toBe(
            false
        );
        expect(() =>
            fitInputPairs([pairOf("half")], [half], NO_TEST_POSITIONS)
        ).toThrow(/half.*unknown/);
    });

    describe("refuses a half whose derived board is already judged on the other side (ADR 0148 § Split)", () => {
        /** A second, unrelated judgement of `board`, with its own id. */
        const judgedAt = (board: Verdict, id: string): Verdict => ({
            ...board,
            id,
            answer: { kind: "right", rightIndexes: [0] },
        });
        const standingOf = (corpus: Verdict[], id: string) => {
            const refusals = pairSplitRefusals(corpus, NO_TEST_POSITIONS);
            return minimalPairStandings(
                corpus.map((v) => ({
                    verdictId: verdictIdOf(v),
                    judgement: v,
                    stored: true,
                    splitRefusal: refusals.get(verdictIdOf(v)),
                }))
            ).get(verdictIdOf(corpus.find((v) => v.id === id)!));
        };

        it("names the reason, and never moves the judgement already assigned", () => {
            // Anchor held-out → the half is held-out; the other judgement of
            // the half's board hashes fit-side and keeps it.
            const { anchor, half } = unit(heldOutBoard, fitBoard);
            const prior = judgedAt(fitBoard, "prior");
            const corpus = [anchor, half, prior];
            const refusals = pairSplitRefusals(corpus, NO_TEST_POSITIONS);
            expect([...refusals.keys()]).toEqual([verdictIdOf(half)]);
            expect(refusals.get(verdictIdOf(half))).toMatch(
                /already judged by prior on the fit side.*never re-sided/
            );
            expect(verdictSidesOf(corpus, NO_TEST_POSITIONS).get("prior")).toBe(
                "fit"
            );
            expect(standingOf(corpus, "half")).toMatchObject({
                kind: "incomplete",
                why: expect.stringMatching(/already judged by prior/),
            });
            // Its anchor loses the pair with it.
            expect(standingOf(corpus, "anchor")?.kind).toBe("incomplete");
        });

        it("forms the pair when the other judgement is on the anchor's own side", () => {
            const { anchor, half } = unit(fitBoard, fitBoard);
            const prior = judgedAt(fitBoard, "prior");
            const corpus = [anchor, half, prior];
            expect(pairSplitRefusals(corpus, NO_TEST_POSITIONS).size).toBe(0);
            expect(standingOf(corpus, "half")?.kind).toBe("paired");
        });

        it("forms the pair when no other judgement shares the board", () => {
            const { anchor, half } = unit(heldOutBoard, fitBoard);
            expect(
                pairSplitRefusals([anchor, half], NO_TEST_POSITIONS).size
            ).toBe(0);
        });
    });
});

describe("burned: held-out positions admitted to the registry anyway (issue #3983)", () => {
    const held = boardOnSide("held-out");
    const entryOf = (v: Verdict): BladeScenario =>
        ({
            spec: v.spec,
            setup: v.setup,
            bot: v.seat,
            deckKnowledge: v.deckKnowledge,
        }) as BladeScenario;

    it("admitting a held-out verdict's scenario moves it fit-side and burns it", () => {
        const admitted = testPositionKeysOf([entryOf(held)]);
        expect(verdictSideOf(held, NO_TEST_POSITIONS)).toBe("held-out");
        expect(burnedOf([held], NO_TEST_POSITIONS)).toEqual([]);
        expect(verdictSideOf(held, admitted)).toBe("fit");
        expect(burnedOf([held], admitted)).toEqual([held]);
        expect(burnedCountOf([held], admitted)).toEqual({
            burned: 1,
            heldOutN: 0,
        });
    });

    it("never burns a fit-by-hash verdict, nor a registry verdict with no store twin", () => {
        const fit = boardOnSide("fit");
        const registry = verdictsFromRegistry(BLADE_SCENARIOS).verdicts;
        const positions = testPositionKeysOf(BLADE_SCENARIOS);
        expect(burnedOf([fit], testPositionKeysOf([entryOf(fit)]))).toEqual([]);
        expect(burnedOf(registry, positions)).toEqual([]);
    });

    it("burns a store twin of a registry entry hashing held-out", () => {
        const registry = verdictsFromRegistry(BLADE_SCENARIOS).verdicts;
        const positions = testPositionKeysOf(BLADE_SCENARIOS);
        const heldByHash = registry.filter(
            (v) => heldOutBucketOf(scenarioKeyOf(v)) === 0
        );
        const twin: Verdict = {
            ...heldByHash[0],
            id: "in-play:twin",
            source: "in-play",
        };
        expect(burnedOf([...registry, twin], positions)).toEqual([twin]);
    });
});

describe("the fit:weights paste decision reads the fit side only (issue #5070)", () => {
    const fitV = { ...boardOnSide("fit"), id: "v:fit" };
    const heldV = { ...boardOnSide("held-out"), id: "v:held" };
    const corpus = [fitV, heldV];

    /** A report whose verdicts are ordered or not, one pair each. */
    const reportOf = (fitOk: boolean, heldOk: boolean): VerdictReport => {
        const mk = (id: string, ok: boolean) => ({
            row: {
                verdictId: id,
                kind: "right" as const,
                candidates: 2,
                pairs: 1,
                violated: ok ? 0 : 1,
                timing: 0,
                ok,
            },
            pair: {
                verdictId: id,
                kind: "right",
                delta: ok ? 5 : -5,
            } as EvalPair,
        });
        const parts = [mk(fitV.id, fitOk), mk(heldV.id, heldOk)];
        const pairs = parts.map((p) => p.pair);
        return {
            verdicts: 2,
            rows: parts.map((p) => p.row),
            pairs,
            satisfied: pairs.filter((p) => p.delta > 0),
            violated: pairs.filter((p) => p.delta <= 0),
            contradictions: [],
            timing: [],
            contradictionsWithTiming: 0,
            blind: [],
            gaps: [],
            errors: [],
            incomplete: [],
        };
    };

    const scoreOn = (report: VerdictReport, side: "fit" | "held-out") =>
        scoreVerdictReport(
            sideReportOf(report, corpus, NO_TEST_POSITIONS, side)
        );

    it("a held-out-only improvement cannot flip the decision", () => {
        const incumbent = reportOf(true, false);
        const fitted = reportOf(true, true);
        // The whole corpus would say PASTE…
        expect(
            improvesOnIncumbent(
                scoreVerdictReport(fitted),
                scoreVerdictReport(incumbent)
            )
        ).toBe(true);
        // …the fit side, which decides, sees no improvement.
        expect(
            improvesOnIncumbent(
                scoreOn(fitted, "fit"),
                scoreOn(incumbent, "fit")
            )
        ).toBe(false);
        // The improvement is real, and is reported on its own side.
        expect(
            improvesOnIncumbent(
                scoreOn(fitted, "held-out"),
                scoreOn(incumbent, "held-out")
            )
        ).toBe(true);
    });

    it("a held-out-only regression cannot veto a fit-side improvement", () => {
        const incumbent = reportOf(false, true);
        const fitted = reportOf(true, false);
        expect(
            improvesOnIncumbent(
                scoreOn(fitted, "fit"),
                scoreOn(incumbent, "fit")
            )
        ).toBe(true);
    });

    it("keeps a contradiction only when both of its pairs are on the side", () => {
        const base = reportOf(false, false);
        const [a, b] = base.pairs;
        const report = { ...base, contradictions: [{ a, b }] };
        expect(
            sideReportOf(report, corpus, NO_TEST_POSITIONS, "fit")
                .contradictions
        ).toHaveLength(0);
    });
});
