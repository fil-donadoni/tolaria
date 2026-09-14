// CR 118.3 / 122.1 / 605.1a (issue #3530) — a FINITE mana source, one whose
// mana ability pays by removing counters from itself, priced by what it has
// LEFT and chosen between by the search rather than by the payment planner.
//
// The two halves are useless apart, which is why they are asserted together
// here. Before this:
//
//   * the evaluation read one of two values per mana source, untapped or
//     tapped, so paying with a two-use depletion land instead of two basics
//     scored +1.000000 BETTER — exactly `manaWeight − tappedManaWeight`,
//     because one source was tapped instead of two. Only the last use ever
//     registered, as the one-off loss of the permanent;
//   * `planManaPayment` returned ONE plan per cast, so the position held a
//     single `cast-spell` candidate and the payment choice never reached the
//     search at all — no Eval Pair, no Verdict, nothing a weight fit could
//     reach.
//
// Nothing here is card-shaped: the finiteness is read off the ability's own
// fixed `cost.removeCounter` leg, and the last test proves it with a second
// finite source whose counter has a different name.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, planManaPayment, type Move } from "../moves";
import { evaluate } from "../evaluate";
import { makeTapForMana } from "../../cards/abilities";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

const WOODLOT = getCardByName("Hickory Woodlot").id; // {T}, remove depletion: {G}{G}
const FOREST = getCardByName("Forest").id;
const BEARS = getCardByName("Grizzly Bears").id; // {1}{G}

function permanent(
    defId: string,
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isSummoningSick: false,
        ...overrides,
    });
}

function position(
    battlefield: CardInstanceState[],
    hand: CardInstanceState[] = []
): GameState {
    const player = makePlayer("p1", { hand, battlefield });
    return {
        ...makeState({ players: [player, makePlayer("p2")] }),
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        stack: [],
    };
}

/** The two post-cast worlds of the issue's own board, hand-built so the claim
 *  is about the EVALUATION and nothing else: same Bears on the battlefield,
 *  same two basics, and the only difference is which sources paid. */
function paidWithBasics(woodlotCounters: number): GameState {
    return position([
        permanent(WOODLOT, "woodlot", {
            isTapped: false,
            counters: { depletion: woodlotCounters },
        }),
        permanent(FOREST, "forest-0", { isTapped: true }),
        permanent(FOREST, "forest-1", { isTapped: true }),
        permanent(BEARS, "bears"),
    ]);
}

/** Same board, paid by spending one of the land's charges. At one counter the
 *  land has sacrificed itself (CR 701.21), so it is simply not there. */
function paidWithTheLand(woodlotCountersBefore: number): GameState {
    const spent = woodlotCountersBefore - 1;
    return position([
        ...(spent > 0
            ? [
                  permanent(WOODLOT, "woodlot", {
                      isTapped: true,
                      counters: { depletion: spent },
                  }),
              ]
            : []),
        permanent(FOREST, "forest-0", { isTapped: false }),
        permanent(FOREST, "forest-1", { isTapped: false }),
        permanent(BEARS, "bears"),
    ]);
}

function castMoves(state: GameState): Extract<Move, { kind: "cast-spell" }>[] {
    return enumerateMoves(state, "p1").filter(
        (move): move is Extract<Move, { kind: "cast-spell" }> =>
            move.kind === "cast-spell"
    );
}

const tapIds = (move: Extract<Move, { kind: "cast-spell" }>): string[] =>
    move.tapPlan.map((tap) => tap.cardInstanceId);

describe("finite mana sources: the evaluation prices the charges (issue #3530)", () => {
    it("scores the renewable payment above the one that spends a charge, at FULL charge", () => {
        const basics = evaluate(paidWithBasics(2), "p1");
        const land = evaluate(paidWithTheLand(2), "p1");
        expect(basics).toBeGreaterThan(land);
    });

    it("scores it above at ONE use remaining, where the land also dies", () => {
        const basics = evaluate(paidWithBasics(1), "p1");
        const land = evaluate(paidWithTheLand(1), "p1");
        expect(basics).toBeGreaterThan(land);
    });

    it("keeps a FULL finite source under a renewable one — the charges REPLACE the source's price", () => {
        // PR #3566 review finding 1. While the term was ADDITIVE to `mana` a
        // Hickory Woodlot at full charge scored 61.0 against a Forest's 48.9 —
        // ~1.7x — so the Bot preferred a two-use land to a land that untaps
        // every turn forever, in every position that held one. The weight is
        // bounded above for exactly this (`evalWeights.ts`), and the ordering
        // is the claim, not the numbers.
        const woodlot = evaluate(
            position([
                permanent(WOODLOT, "woodlot", {
                    counters: { depletion: 2 },
                }),
            ]),
            "p1"
        );
        const forest = evaluate(
            position([permanent(FOREST, "forest-0")]),
            "p1"
        );
        expect(woodlot).toBeLessThan(forest);
    });

    it("prices a charge, not merely the death: two charges beat one", () => {
        const full = evaluate(paidWithBasics(2), "p1");
        const half = evaluate(paidWithBasics(1), "p1");
        expect(full).toBeGreaterThan(half);
    });
});

describe("finite mana sources: the payment is a CHOICE the search sees (issue #3530)", () => {
    it("offers two cast candidates differing only in their tap plan", () => {
        const state = position(
            [
                permanent(WOODLOT, "woodlot", {
                    isTapped: false,
                    counters: { depletion: 2 },
                }),
                permanent(FOREST, "forest-0"),
                permanent(FOREST, "forest-1"),
            ],
            [
                makeInstance(BEARS, {
                    id: "bears",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                }),
            ]
        );
        const casts = castMoves(state);
        expect(casts).toHaveLength(2);
        expect(casts.every((move) => move.cardInstanceId === "bears")).toBe(
            true
        );
        const plans = casts.map(tapIds).sort();
        expect(plans).toEqual([["forest-0", "forest-1"], ["woodlot"]]);
        // Every other field is identical — the plan IS the whole difference.
        const [a, b] = casts.map((move) => ({ ...move, tapPlan: undefined }));
        expect(a).toEqual(b);
    });

    it("emits ONE plan, byte-identical to the greedy one, on a board of renewable sources", () => {
        const state = position(
            [
                permanent(FOREST, "forest-0"),
                permanent(FOREST, "forest-1"),
                permanent(FOREST, "forest-2"),
            ],
            [
                makeInstance(BEARS, {
                    id: "bears",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "hand",
                }),
            ]
        );
        const casts = castMoves(state);
        expect(casts).toHaveLength(1);
        expect(casts[0].tapPlan).toEqual(
            planManaPayment(
                state,
                state.players[0],
                { G: 1, X: 1 },
                { cardInstanceId: "bears", cardDef: null }
            )
        );
    });

    it("prices only the charges the planner can actually spend", () => {
        // PR #3566 review finding 3: a counter-removal mana ability with no
        // {T} to hang the leg on is one `isAutoPayableManaAbilityCost` refuses,
        // so the search can never spend those charges — and Iceberg's ice
        // counters are not a fuel gauge at all ("{3}: Put an ice counter on
        // this enchantment"). Pricing them moved positions the Bot cannot act
        // on.
        // Five ice counters against one: both are a live mana source (the leg
        // is payable either way), so a term that priced these charges would
        // separate them. It must not.
        const iceberg = getCardByName("Iceberg").id;
        const five = evaluate(
            position([permanent(iceberg, "iceberg", { counters: { ice: 5 } })]),
            "p1"
        );
        const one = evaluate(
            position([permanent(iceberg, "iceberg", { counters: { ice: 1 } })]),
            "p1"
        );
        expect(five).toBe(one);
    });

    it("offers the same choice for a finite source with a DIFFERENT counter type", () => {
        // Derived from the cost, never from a name: a second cycle spending
        // "charge" counters and making {G}{G} must behave exactly like the
        // depletion cycle does.
        const chargeLand: CardDefinition = {
            id: "test-charge-land",
            name: "Test Charge Land",
            rarity: "common",
            oracleText:
                "{T}, Remove a charge counter from this land: Add {G}{G}.",
            types: ["Land"],
            activatedAbilities: [
                {
                    ...makeTapForMana({
                        id: "charge-land-mana",
                        oracleText:
                            "{T}, Remove a charge counter from this land: Add {G}{G}.",
                        produces: { G: 2 },
                    }),
                    cost: {
                        tap: true,
                        removeCounter: { type: "charge", count: 1 },
                    },
                },
            ],
        };
        withTemporaryDefinition(chargeLand, () => {
            const state = position(
                [
                    permanent(chargeLand.id, "charge-land", {
                        counters: { charge: 2 },
                    }),
                    permanent(FOREST, "forest-0"),
                    permanent(FOREST, "forest-1"),
                ],
                [
                    makeInstance(BEARS, {
                        id: "bears",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ]
            );
            const plans = castMoves(state).map(tapIds).sort();
            expect(plans).toEqual([["charge-land"], ["forest-0", "forest-1"]]);
        });
    });
});
