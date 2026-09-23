// UDS — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    discardToGraveyard,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { getDefinition } from "../../../index";

const compost = getDefinition("2523c403-0025-48c7-8ff1-e66ca27ee585");
const darkRitual = getDefinition("ebb6664d-23ca-456e-9916-afcd6f26aa7f");
const counterspell = getDefinition("0df55e3f-14de-46ef-b6b1-616618724d9e");
const hypnoticSpecter = getDefinition("b43b900f-2d9b-442b-9699-058483604ec9");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

/** p1 controls Compost with two cards to draw; p2 holds `p2Hand`. */
function compostBoard(
    p2Hand: ReturnType<typeof makeInstance>[] = []
): GameState {
    const card = (cardId: string, id: string, owner: string, zone: string) =>
        makeInstance(cardId, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: zone as "library",
        });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [card(compost.id, "compost", "p1", "battlefield")],
                library: [
                    card(grizzlyBears.id, "lib-1", "p1", "library"),
                    card(grizzlyBears.id, "lib-2", "p1", "library"),
                ],
            }),
            makePlayer("p2", { hand: p2Hand }),
        ],
    });
}

/** Collects the triggers the last action produced and returns Compost's. */
function compostTriggers(state: GameState) {
    processPendingActionTriggers(state);
    return state.stack.filter((i) => i.triggeredAbilityId === "compost-draw");
}

describe("Compost (CR 603.6c graveyard-from-anywhere trigger, CR 400.3 owner's graveyard)", () => {
    it("a black spell an opponent resolves reaches their graveyard off the stack and draws on accept (CR 608.2n)", () => {
        const state = compostBoard();
        pushSpell(state, darkRitual.id, "p2");
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.card.id)).toContain(
            darkRitual.id
        );
        expect(compostTriggers(state)).toHaveLength(1);

        // The "you may" is a real decision: resolving suspends on it.
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("a black spell countered on the stack triggers it too (CR 701.6a)", () => {
        const state = compostBoard();
        const ritual = pushSpell(state, darkRitual.id, "p2");
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: ritual.id },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(
            ritual.id
        );
        // Counterspell is blue and in p1's OWN graveyard: neither counts, so
        // exactly one trigger — the countered Dark Ritual's.
        expect(compostTriggers(state)).toHaveLength(1);
    });

    it("declining the draw leaves the hand alone", () => {
        const state = compostBoard();
        pushSpell(state, darkRitual.id, "p2");
        resolveTopOfStack(state);
        expect(compostTriggers(state)).toHaveLength(1);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("a black card reaching its controller's OWN graveyard does not trigger", () => {
        const state = compostBoard();
        pushSpell(state, darkRitual.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            darkRitual.id
        );
        expect(compostTriggers(state)).toHaveLength(0);
    });

    it("an opponent's discard counts only when the card is black (CR 701.9)", () => {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = compostBoard([specter, bears]);

        expect(
            discardToGraveyard(state, "p2", "bears", {
                kind: "effect",
                controllerId: "p2",
            })
        ).toBe(true);
        expect(compostTriggers(state)).toHaveLength(0);

        expect(
            discardToGraveyard(state, "p2", "specter", {
                kind: "effect",
                controllerId: "p2",
            })
        ).toBe(true);
        expect(compostTriggers(state)).toHaveLength(1);
    });

    it("a black permanent card dying counts; a black TOKEN does not (CR 111.7)", () => {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const token = makeInstance(hypnoticSpecter.id, {
            id: "specter-token",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isToken: true,
        });
        const state = compostBoard();
        state.players[1].battlefield.push(specter, token);

        removePermanentTo(state, "specter-token", "graveyard");
        expect(compostTriggers(state)).toHaveLength(0);

        removePermanentTo(state, "specter", "graveyard");
        expect(compostTriggers(state)).toHaveLength(1);
    });
});
