// ROE — green. Vengevine: a graveyard-zone cast trigger (CR 113.6m) whose
// intervening if (CR 603.4) reads the caster's per-type spell tally
// (`nthSpellOfTypeThisTurn`). Every cast below goes through the real commit
// path (`tryAutoCommitPendingCast`), so the SPELL_CAST event and the trigger
// scan are the engine's own.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { tryAutoCommitPendingCast } from "../../../../game";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import type { CardInstanceState } from "../../../../gre/state";
import type { ManaCost } from "../../../types";

const VENGEVINE = "51eb9f05-9d5a-4196-9329-626ce4793c42";
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // {1}{G} Creature
const DARK_RITUAL = "ebb6664d-23ca-456e-9916-afcd6f26aa7f"; // {B} Instant
const TRIGGER_ID = "vengevine-return";

function card(
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        zone,
        controllerId: "p1",
        ownerId: "p1",
    });
}

const COSTS: Record<string, ManaCost> = {
    [GRIZZLY_BEARS]: { X: 1, G: 1 },
    [DARK_RITUAL]: { B: 1 },
};
// An exact single-colour pool per spell, so no CR 601.2g spend choice parks.
const POOLS: Record<string, Partial<Record<"B" | "G", number>>> = {
    [GRIZZLY_BEARS]: { G: 2 },
    [DARK_RITUAL]: { B: 1 },
};

function vengevineState(zones: {
    graveyard?: CardInstanceState[];
    battlefield?: CardInstanceState[];
    hand: CardInstanceState[];
    spellTypesCastThisTurn?: Record<string, number>;
    spellsCastThisTurn?: number;
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: zones.hand,
                graveyard: zones.graveyard ?? [],
                battlefield: zones.battlefield ?? [],
                spellsCastThisTurn: zones.spellsCastThisTurn,
                spellTypesCastThisTurn: zones.spellTypesCastThisTurn,
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Casts `id` from p1's hand through the real commit path (p1 holding
 *  priority, as after a resolution in their own main phase). */
function castFromHand(state: GameState, id: string) {
    state.priorityPlayerId = "p1";
    const inHand = state.players[0].hand.find((c) => c.id === id)!;
    const cardId = (inHand.card as { id: string }).id;
    state.players[0].manaPool = {
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
        C: 0,
        ...POOLS[cardId],
    };
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: id,
        manaCost: COSTS[cardId],
        tappedLandIds: [],
    };
    expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
}

const vengevineTriggers = (state: GameState) =>
    state.stack.filter((i) => i.triggeredAbilityId === TRIGGER_ID);

describe("Vengevine (CR 113.6m, CR 603.4)", () => {
    it("the first creature spell does not trigger; a noncreature spell does not advance the tally; the second creature spell does, and returns Vengevine", () => {
        const state = vengevineState({
            graveyard: [card(VENGEVINE, "vine", "graveyard")],
            hand: [
                card(GRIZZLY_BEARS, "bears1", "hand"),
                card(DARK_RITUAL, "ritual", "hand"),
                card(GRIZZLY_BEARS, "bears2", "hand"),
            ],
        });
        castFromHand(state, "bears1");
        expect(vengevineTriggers(state)).toHaveLength(0);
        resolveTopOfStack(state);
        castFromHand(state, "ritual");
        expect(vengevineTriggers(state)).toHaveLength(0);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        castFromHand(state, "bears2");
        expect(vengevineTriggers(state)).toHaveLength(1);

        expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
            TRIGGER_ID
        );
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the "may"
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "vine")).toBe(
            true
        );
        expect(state.players[0].graveyard.some((c) => c.id === "vine")).toBe(
            false
        );
    });

    it("declining the 'may' leaves Vengevine in the graveyard", () => {
        const state = vengevineState({
            graveyard: [card(VENGEVINE, "vine", "graveyard")],
            hand: [card(GRIZZLY_BEARS, "bears2", "hand")],
            spellsCastThisTurn: 1,
            spellTypesCastThisTurn: { Creature: 1 },
        });
        castFromHand(state, "bears2");
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].graveyard.some((c) => c.id === "vine")).toBe(
            true
        );
    });

    it("triggers only from the graveyard — never from the battlefield or the hand", () => {
        const state = vengevineState({
            battlefield: [card(VENGEVINE, "vine-bf", "battlefield")],
            hand: [
                card(VENGEVINE, "vine-hand", "hand"),
                card(GRIZZLY_BEARS, "bears2", "hand"),
            ],
            spellsCastThisTurn: 1,
            spellTypesCastThisTurn: { Creature: 1 },
        });
        castFromHand(state, "bears2");
        expect(vengevineTriggers(state)).toHaveLength(0);
    });

    it("re-checks the intervening if on resolution against the cast-time count — more creature spells cast since do not undo it", () => {
        const state = vengevineState({
            graveyard: [card(VENGEVINE, "vine", "graveyard")],
            hand: [card(GRIZZLY_BEARS, "bears2", "hand")],
            spellsCastThisTurn: 1,
            spellTypesCastThisTurn: { Creature: 1 },
        });
        castFromHand(state, "bears2");
        expect(vengevineTriggers(state)).toHaveLength(1);
        // A third creature spell cast before the trigger resolves (a flash
        // creature in response) leaves the live tally at 3: "it" is still
        // the second creature spell, so the re-check must read the cast.
        state.players[0].spellsCastThisTurn = 3;
        state.players[0].spellTypesCastThisTurn = { Creature: 3 };
        expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
            TRIGGER_ID
        );
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "vine")).toBe(
            true
        );
    });

    it("an intervening if that no longer holds on resolution removes the trigger (CR 603.4)", () => {
        const state = vengevineState({
            graveyard: [card(VENGEVINE, "vine", "graveyard")],
            hand: [card(GRIZZLY_BEARS, "bears2", "hand")],
            spellsCastThisTurn: 1,
            spellTypesCastThisTurn: { Creature: 1 },
        });
        castFromHand(state, "bears2");
        const trigger = vengevineTriggers(state)[0];
        // Rewrite the recorded cast into a FIRST creature spell: the
        // resolution-time check must read it and fizzle, never prompt.
        const event = trigger.triggerEvent as {
            casterSpellTypeCountsThisTurn?: Record<string, number>;
        };
        event.casterSpellTypeCountsThisTurn = {};
        resolveTopOfStack(state);
        expect(vengevineTriggers(state)).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === "vine")).toBe(
            true
        );
    });
});
