// Casting ONE HALF of a split card, end to end (CR 709.3, ADR 0121).
//
// The seam this file proves is the one CR 709.3 adds and no other cast mode
// has: the choice happens BEFORE the card is on the stack, so a split card
// offers two half options and NO printed cast. Every other mode in
// `CAST_MODE_CENSUS` is a different price for the printed spell and rides the
// printed conjunction; this one replaces it. A surface that kept offering the
// printed cast would offer a {2}{W}{U} announcement that resolves to neither
// half — and, like the CR 715.3a pre-commit problem before it, nothing
// anywhere would be red.
//
// The assertions walk the path a real cast walks: legality
// (`getLegalActions`) → the option list (`castOptionAlternativeCosts`) → the
// announcement's subject (`castSubjectDefinition`, the decision `announceCast`
// makes) → the stack item (`applyCastModeCharacteristics`, what all four
// commit sites call) → the WIRE (`projectPublicState`, all the client ever
// sees) → the departure from the stack (CR 709.4).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import {
    applyCastModeCharacteristics,
    castSubjectDefinition,
    castSubjectView,
    independentCastOptionsFor,
} from "../castMode";
import { castOptionAlternativeCosts } from "../castPermissions";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import { getLegalActions } from "../rules";
import {
    splitCastAltCostId,
    splitCastOptionsFor,
    revertSplitIdentity,
} from "../splitCast";
import { splitHalfDefinitionId } from "../../cards/splitCard";
import type { CardInstanceState, GameState, StackItem } from "../state";

const STAND_DELIVER = getCardByName("Stand // Deliver");
const PLAINS = getCardByName("Plains").id;
const ISLAND = getCardByName("Island").id;
const HILL_GIANT = getCardByName("Hill Giant").id;

const LEFT_ID = splitHalfDefinitionId(STAND_DELIVER.id, "left");
const RIGHT_ID = splitHalfDefinitionId(STAND_DELIVER.id, "right");

/** p1 holds Stand // Deliver with `plains` Plains and `islands` Islands; p2
 *  has a Hill Giant (a legal target for BOTH halves — a creature, and a
 *  permanent). */
function position(plains: number, islands: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(STAND_DELIVER.id, {
                        id: "split",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    ...Array.from({ length: plains }, (_, i) =>
                        makeInstance(PLAINS, {
                            id: `plains${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                    ...Array.from({ length: islands }, (_, i) =>
                        makeInstance(ISLAND, {
                            id: `island${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const handCard = (state: GameState): CardInstanceState =>
    state.players[0].hand.find((c) => c.id === "split")!;

/** The stack item a committed half cast produces — built the way every commit
 *  site in `game.ts` builds one (spread the card out of its zone, stamp,
 *  push), so this is the real object and not a hand-written stand-in. */
function pushHalf(state: GameState, side: "left" | "right"): StackItem {
    const player = state.players[0];
    const card = player.hand.splice(
        player.hand.findIndex((c) => c.id === "split"),
        1
    )[0];
    const item: StackItem = {
        ...card,
        zone: "stack",
        castById: "p1",
        targets: [{ type: "permanent", id: "giant" }],
    };
    applyCastModeCharacteristics(
        NO_BOARD_LAYER_VIEW,
        item,
        splitCastAltCostId(STAND_DELIVER, side)
    );
    state.stack.push(item);
    return item;
}

describe("CR 709.3 — two half options, and NO printed cast", () => {
    it("the option list is exactly the two halves", () => {
        const state = position(1, 3);
        const options = castOptionAlternativeCosts(
            state,
            state.players[0],
            handCard(state)
        );
        expect(options.map((o) => o.id)).toEqual([
            splitCastAltCostId(STAND_DELIVER, "left"),
            splitCastAltCostId(STAND_DELIVER, "right"),
        ]);
        // Each row names the half being cast — `alt-cost-picker.tsx` renders
        // `description` verbatim, so this IS what the player reads.
        expect(options[0].description).toContain("Stand");
        expect(options[1].description).toContain("Deliver");
        expect(options[0].mana).toEqual({ W: 1 });
        expect(options[1].mana).toEqual({ X: 2, U: 1 });
    });

    it("the halves are the card's INDEPENDENT options, judged on their own", () => {
        const state = position(1, 3);
        expect(
            independentCastOptionsFor(handCard(state)).map((o) => o.id)
        ).toEqual([
            splitCastAltCostId(STAND_DELIVER, "left"),
            splitCastAltCostId(STAND_DELIVER, "right"),
        ]);
        // An ordinary card contributes none — the list is not "every alt cost".
        const bears = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        expect(independentCastOptionsFor(bears)).toEqual([]);
        expect(splitCastOptionsFor(bears)).toEqual([]);
    });

    it("the client is told the printed row does not exist (CR 709.3)", () => {
        // SURFACE, through the real projection: the picker's "Pay mana cost"
        // row is driven by `printedCostCastUnavailable` and nothing else.
        const state = position(1, 3);
        const projected = projectPublicState(state, 1, "p1");
        const inHand = projected.players[0].hand.find(
            (c) => c !== null && c.id === "split"
        )!;
        expect(inHand.legalActions).toContain("cast");
        expect(inHand.printedCostCastUnavailable).toBe(true);
    });
});

describe("CR 709.3a — only the CHOSEN half is evaluated", () => {
    it("each half's own cost decides legality, and neither lends it to the other", () => {
        // One Plains: Stand ({W}) is payable, Deliver ({2}{U}) is not — and
        // the card is castable, because ONE half is.
        const onePlains = position(1, 0);
        expect(
            getLegalActions(
                onePlains,
                onePlains.players[0],
                handCard(onePlains)
            )
        ).toContain("cast");
        // No land at all: neither half is payable, so the card is not
        // castable. Without the CR 709.3 leg the printed conjunction would
        // still be asking about a {2}{W}{U} cast nobody can announce.
        const noLand = position(0, 0);
        expect(
            getLegalActions(noLand, noLand.players[0], handCard(noLand))
        ).not.toContain("cast");
    });

    it("the announced SUBJECT is the twin, before any stack item exists", () => {
        const state = position(1, 3);
        const left = castSubjectDefinition(
            STAND_DELIVER,
            splitCastAltCostId(STAND_DELIVER, "left")
        );
        const right = castSubjectDefinition(
            STAND_DELIVER,
            splitCastAltCostId(STAND_DELIVER, "right")
        );
        expect(left?.id).toBe(LEFT_ID);
        expect(right?.id).toBe(RIGHT_ID);
        // And the two are NOT the same object — a census that resolved both
        // ids to one twin would pass every single-half assertion.
        expect(left?.id).not.toBe(right?.id);
        expect(left?.targetRequirement?.type).toBe("Creature");
        expect(right?.targetRequirement?.type).toContain("Enchantment");
        // The instance view every cost/timing consumer prices against.
        expect(
            (
                castSubjectView(
                    handCard(state),
                    splitCastAltCostId(STAND_DELIVER, "right")
                ).card as { id?: string }
            ).id
        ).toBe(RIGHT_ID);
    });

    it("a printed-cost announcement resolves to the CARD, not to a half", () => {
        // The fail-closed half of the same seam: with no alternative cost id
        // the subject is the combined card, which is precisely why
        // `announceCast` refuses that announcement for a split card.
        expect(castSubjectDefinition(STAND_DELIVER, undefined)?.id).toBe(
            STAND_DELIVER.id
        );
    });
});

describe("CR 709.3b — on the stack only the chosen half exists", () => {
    it("the stack item IS the half, and the other half is unreachable", () => {
        const state = position(1, 3);
        const item = pushHalf(state, "right");
        expect((item.card as { id?: string }).id).toBe(RIGHT_ID);
        expect(item.splitHalfOf).toBe(STAND_DELIVER.id);
        expect(item.types).toEqual(["Instant"]);
        // "The other half's characteristics are treated as though they didn't
        // exist" — and neither does the COMBINATION: nothing on the stack
        // costs {2}{W}{U} or is named "Stand // Deliver".
        const projected = projectPublicState(state, 1, "p1");
        const onStack = projected.stack[0];
        const shown = (onStack.card as { id?: string }).id;
        expect(shown).toBe(RIGHT_ID);
        expect(shown).not.toBe(LEFT_ID);
        expect(shown).not.toBe(STAND_DELIVER.id);
    });

    it("the LEFT half is its own object, not the right one", () => {
        const state = position(1, 3);
        const item = pushHalf(state, "left");
        expect((item.card as { id?: string }).id).toBe(LEFT_ID);
        const projected = projectPublicState(state, 1, "p1");
        expect((projected.stack[0].card as { id?: string }).id).toBe(LEFT_ID);
    });

    it("the stamp is idempotent — a re-walked commit cannot lose the parent", () => {
        const state = position(1, 3);
        const item = pushHalf(state, "left");
        applyCastModeCharacteristics(
            NO_BOARD_LAYER_VIEW,
            item,
            splitCastAltCostId(STAND_DELIVER, "right")
        );
        expect((item.card as { id?: string }).id).toBe(LEFT_ID);
        expect(item.splitHalfOf).toBe(STAND_DELIVER.id);
    });
});

describe("CR 709.4 — off the stack the card is its halves combined again", () => {
    it("the revert restores the COMBINED identity", () => {
        const state = position(1, 3);
        const item = pushHalf(state, "right");
        revertSplitIdentity(item);
        expect((item.card as { id?: string }).id).toBe(STAND_DELIVER.id);
        expect(item.splitHalfOf).toBeUndefined();
        expect(item.types).toEqual([...STAND_DELIVER.types]);
    });

    it("the revert is a no-op on an object never cast as a half", () => {
        const state = position(1, 3);
        const card = handCard(state);
        const before = (card.card as { id?: string }).id;
        revertSplitIdentity(card);
        expect((card.card as { id?: string }).id).toBe(before);
    });
});
