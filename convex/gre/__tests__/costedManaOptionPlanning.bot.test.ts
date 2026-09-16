// CR 601.2g / 106.6 / 701.43a (issue #3359) — the Bot can PLAN and PAY a mana
// ability's COSTED option.
//
// Arena of Glory is the shipped carrier: "{T}: Add {R}" first, then "{R}, {T},
// Exert this land: Add {R}{R}" carrying the CR 106.6 haste rider. Both halves
// were silent before this issue:
//
//   1. never planned — `planManaPayment`'s per-colour map is first-option-wins,
//      so the free "{T}: Add {R}" always took {R} and the second option was
//      unreachable however the plan was built;
//   2. never paid — `applyTapPlan` applied a tap plan with a bare
//      `src.isTapped = true`, paying neither the {R} leg nor the exert, so the
//      search priced the costed half of the card at nothing.
//
// The planner half is asserted through `castTapPlans`, the seam
// `enumerateCastMoves` actually calls, so what is tested is the candidate set
// the search really receives — never `planManaPayment` in isolation.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { castTapPlans, enumerateMoves, planManaPayment } from "../moves";
import type { Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { arenaOfGlory } from "../../cards/sets/mh3/colorless";
import { mountain } from "../../cards/sets/lea";
import { getCardByName } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

/** {1}{R} creature — a cast the haste rider is worth reaching for. */
const SKI_PATROL = getCardByName("Goblin Ski Patrol")!;
/** {R} instant — never a creature spell, so the rider buys it nothing. */
const BOLT = getCardByName("Lightning Bolt")!;

/** Index of "{R}, {T}, Exert this land: Add {R}{R}" in the unified mana-tap
 *  option list. Arena of Glory is a plain Land with no basic subtype, so the
 *  list is exactly its two declared abilities in order — the same index
 *  `tapSourceIntoPayment` (`convex/game.ts`) resolves against. */
const EXERT_OPTION_INDEX = 1;

/** Arena of Glory plus `funders` Mountains, and optionally a spell in hand. */
function board(funders: number, handCard?: CardDefinition): GameState {
    const arena = makeInstance(arenaOfGlory.id, {
        id: "arena",
        controllerId: "p1",
        ownerId: "p1",
    });
    const lands = Array.from({ length: funders }, (_, i) =>
        makeInstance(mountain.id, {
            id: `mountain-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const hand: CardInstanceState[] = handCard
        ? [
              makeInstance(handCard.id, {
                  id: "spell",
                  controllerId: "p1",
                  ownerId: "p1",
                  zone: "hand",
              }),
          ]
        : [];
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [arena, ...lands], hand }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const castOf = (cardDef: CardDefinition, bestowed?: boolean) => ({
    cardInstanceId: "spell",
    cardDef,
    chosenX: 0,
    ...(bestowed ? { bestowed: true } : {}),
});

const arenaOn = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "arena")!;
const mountainOn = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "mountain-0")!;

describe("castTapPlans offers the costed option as a SECOND candidate (CR 601.2g, issue #3359)", () => {
    it("offers the free plan AND the exert plan, funder first", () => {
        const state = board(1);

        const plans = castTapPlans(
            state,
            state.players[0],
            { X: 1, R: 1 },
            castOf(SKI_PATROL)
        );

        // Both halves matter and neither is redundant. The FIRST plan is the
        // greedy one this planner has always returned — asserted here because
        // making the costed option replace it in place was measured to STRAND
        // payable casts (this very board stopped paying for any two-drop). The
        // SECOND is the one the issue exists for, and its ORDER is load-bearing:
        // the Mountain's tap must precede the costed entry, or
        // `applyManaAbilityManaCost` finds an empty pool when
        // `tapSourceIntoPayment` charges the {R} leg and rolls the mutation back.
        expect(plans).toEqual([
            [
                { cardInstanceId: "arena", manaChoiceIndex: 0 },
                { cardInstanceId: "mountain-0" },
            ],
            [
                { cardInstanceId: "mountain-0" },
                {
                    cardInstanceId: "arena",
                    manaChoiceIndex: EXERT_OPTION_INDEX,
                },
            ],
        ]);
    });

    it("a NONCREATURE spell is offered the free plan only — the rider buys it nothing (CR 106.6)", () => {
        const state = board(1);

        const plans = castTapPlans(
            state,
            state.players[0],
            { X: 1, R: 1 },
            castOf(BOLT)
        );

        expect(plans).toEqual([
            [
                { cardInstanceId: "arena", manaChoiceIndex: 0 },
                { cardInstanceId: "mountain-0" },
            ],
        ]);
    });

    it("a BESTOWED cast is an Aura spell, so the rider never fires (CR 702.103b)", () => {
        const state = board(1);

        const plans = castTapPlans(
            state,
            state.players[0],
            { X: 1, R: 1 },
            castOf(SKI_PATROL, true)
        );

        expect(plans).toHaveLength(1);
        expect(
            plans[0].some((tap) => tap.manaChoiceIndex === EXERT_OPTION_INDEX)
        ).toBe(false);
    });

    it("the POLICY alone never admits the option — the shared authority does", () => {
        const state = board(1);

        // `spend` with no cast at all (an activation payment, a morph): the plan
        // context is undefined, so `manaTapOptionSpendsUnplannedResource`
        // refuses the option exactly as it refuses it for the human auto-tap
        // solver, and the plan comes back as the ordinary greedy one. Without
        // this, "the policy was passed" would be mistaken for "the option was
        // admitted", and the Bot would spend an exert on a payment that buys
        // nothing with it.
        const planned = planManaPayment(
            state,
            state.players[0],
            { X: 2 },
            undefined,
            undefined,
            undefined,
            undefined,
            "spend"
        );

        expect(planned).toEqual([
            { cardInstanceId: "arena", manaChoiceIndex: 0 },
            { cardInstanceId: "mountain-0" },
        ]);
    });

    it("no funder for the option's own {R} leg — the costed plan is never offered", () => {
        // Arena alone: the free option pays the one mana this cost needs, and
        // the costed option cannot be funded at all. A planner that offered it
        // anyway would emit a plan `applyManaAbilityManaCost` throws on.
        const state = board(0);

        const plans = castTapPlans(
            state,
            state.players[0],
            { R: 1 },
            castOf(SKI_PATROL)
        );

        // The index is named even here: Arena carries TWO options, so
        // `getProducibleManaSourceView` reports `needIndex` and the plan must
        // tell the tap mutations which one it means.
        expect(plans).toEqual([
            [{ cardInstanceId: "arena", manaChoiceIndex: 0 }],
        ]);
    });
});

describe("the search PAYS the whole cost of the option it planned (CR 701.43a, issue #3359)", () => {
    /** The enumerated cast whose tap plan takes Arena's costed option, and its
     *  free-option twin — read off `enumerateMoves` rather than hand-built, so
     *  what is applied below is a Move the search really receives. */
    function castMoves(state: GameState) {
        const casts = enumerateMoves(state, "p1").filter(
            (m: Move): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "spell"
        );
        return {
            costed: casts.find((m) =>
                m.tapPlan.some(
                    (tap) => tap.manaChoiceIndex === EXERT_OPTION_INDEX
                )
            ),
            free: casts.find(
                (m) =>
                    !m.tapPlan.some(
                        (tap) => tap.manaChoiceIndex === EXERT_OPTION_INDEX
                    )
            ),
        };
    }

    it("the costed cast is enumerated and its exert leg is paid inside the search", () => {
        const state = board(1, SKI_PATROL);
        const { costed } = castMoves(state);
        expect(costed).toBeDefined();

        const next = applyMoveForSearch(state, "p1", costed!);

        // CR 701.43a — the payment spends the land's NEXT UNTAP STEP. Without
        // this the search has Arena untapping next simulated turn and tapping
        // again forever, so the costed half of the card is free in the very
        // tree that picks the move.
        expect(arenaOn(next).skipNextUntap).toBe(true);
        expect(arenaOn(next).isTapped).toBe(true);
        // CR 601.2f — and the {R} leg is paid by the funder the plan ordered
        // first, which the coarse mana model reflects by tapping it.
        expect(mountainOn(next).isTapped).toBe(true);
        // The source state is untouched — the applier clones (issue #2789's
        // "expected and actual are the same object" shape).
        expect(arenaOn(state).skipNextUntap).toBeUndefined();
    });

    it("the FREE cast exerts nothing — the twin that makes the assertion above discriminate", () => {
        const state = board(1, SKI_PATROL);
        const { free } = castMoves(state);
        expect(free).toBeDefined();

        const next = applyMoveForSearch(state, "p1", free!);

        // Without this half, an applier that simply exerted every Arena tap
        // would pass the test above while pricing the FREE option as if it cost
        // an untap step.
        expect(arenaOn(next).skipNextUntap).toBeUndefined();
        expect(arenaOn(next).isTapped).toBe(true);
    });
});
