// STX (Strixhaven) — white card behavior tests (ADR 0043 colour split). Each
// card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { eliteSpellbinder } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { getLegalActions } from "../../../../gre/rules";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { registerTokenDefinition } from "../../../index";

// A vanilla {1}{G} 2/2 — the nonland card in the opponent's hand. Cheap enough
// that the {2} tax is the ONLY thing that can make it unaffordable at 3 mana.
const BEAR_ID = "test-stx-white-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const PLAINS_ID = "test-stx-white-plains";
registerTokenDefinition({
    id: PLAINS_ID,
    name: PLAINS_ID,
    rarity: "common",
    types: ["Land"],
});

const ETB_EVENT: StackItem["triggerEvent"] = {
    type: "PERMANENT_ENTERED",
    instanceId: "binder",
    controllerId: "p1",
    types: ["Creature"],
} as StackItem["triggerEvent"];

/** Elite Spellbinder on p1's battlefield; p2 holds `hand` and `pool` green
 *  mana. p2 is the active player with priority, so the only variable in the
 *  cast affordances below is the cost (CR 307.1 — a creature is cast in its
 *  controller's own main phase). */
function setup(hand: CardInstanceState[], pool: number): GameState {
    const binder = makeInstance(eliteSpellbinder.id, {
        id: "binder",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [binder] }),
            makePlayer("p2", {
                hand,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: pool, C: 0 },
            }),
        ],
        activePlayerId: "p2",
        priorityPlayerId: "p2",
    });
}

function bear(id: string): CardInstanceState {
    return makeInstance(BEAR_ID, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
}

/** Puts the ETB trigger on the stack the way the engine does right after a
 *  targeted trigger is put there (CR 603.3d). "Target opponent" has exactly
 *  one legal choice in a two-player game, so the engine locks it without a
 *  PendingTarget and the trigger resolves as-is. */
function putTriggerOnStack(state: GameState): StackItem {
    const source = state.players[0].battlefield[0];
    const trig: StackItem = {
        ...source,
        id: "elite-spellbinder-trig",
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "elite-spellbinder-etb",
        triggerSourceId: source.id,
        triggerEvent: ETB_EVENT,
        targets: [{ type: "player", id: "p2" }],
    };
    state.stack.push(trig);
    return trig;
}

/** Answers the head PendingChoice with `ids`. */
function answer(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("Elite Spellbinder (STX — look, exile, owner may play it taxed {2}; CR 400.2 / 601.3e / 601.2f)", () => {
    it("looks at the opponent's whole hand, exiles the chosen nonland card and hands it back playable but taxed", () => {
        const state = setup([bear("kept"), bear("taken")], 3);
        putTriggerOnStack(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the pick

        // CR 400.2 — the look happened before the pick: BOTH hand cards are
        // known to the looker alone, not just the one taken.
        for (const c of state.players[1].hand) {
            expect(c.knownTo).toEqual(["p1"]);
        }
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1"); // the controller chooses…
        expect(head.zoneOwnerId).toBe("p2"); // …from the opponent's hand
        expect(head.candidateIds).toEqual(["kept", "taken"]);

        answer(state, ["taken"]);
        expect(state.stack).toHaveLength(0);

        // CR 400.7 — the card left the hand for its OWNER's exile.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["kept"]);
        const exiled = state.players[1].exile.find((c) => c.id === "taken")!;
        // CR 601.3e — the OWNER (not this card's controller) may play it, for
        // as long as it remains exiled: an open-ended window, no expiry turn.
        expect(exiled.castableFromExileBy).toBe("p2");
        expect(exiled.castableFromExileUntilTurn).toBeUndefined();
        // CR 601.2f — taxed {2}, object-scoped.
        expect(exiled.castFromExileCostIncrease).toEqual({ X: 2 });

        // The tax bites: {1}{G} + {2} = 4, and p2 has 3.
        expect(
            getLegalActions(state, state.players[1], exiled, false, "p2")
        ).not.toContain("cast");

        // SURFACE (the whole point of the grant) — the owner's own projection
        // carries the exiled card WITH its gated cast affordance, so the
        // client's Cast button is driven by the taxed price, not the printed
        // one.
        const forOwner = projectPublicState(state, 1, "p2");
        const slim = forOwner.players[1].exile.find((c) => c.id === "taken")!;
        expect(slim.legalActions).toBeDefined();
        expect(slim.legalActions).not.toContain("cast");
    });

    it("keeps taxing the exiled card after Elite Spellbinder has left the battlefield (CR 601.2f — an object tax, not a battlefield static)", () => {
        const state = setup([bear("taken")], 4);
        putTriggerOnStack(state);
        resolveTopOfStack(state);
        answer(state, ["taken"]);

        // Elite Spellbinder dies. A `cost-modifier` static would stop applying
        // right here; this tax rides the exiled card object.
        removePermanentTo(state, "binder", "graveyard");
        expect(state.players[0].battlefield).toHaveLength(0);

        const exiled = state.players[1].exile.find((c) => c.id === "taken")!;
        expect(exiled.castFromExileCostIncrease).toEqual({ X: 2 });
        // 4 mana affords {1}{G} + {2} exactly — the grant survives its source.
        expect(
            getLegalActions(state, state.players[1], exiled, false, "p2")
        ).toContain("cast");
        const forOwner = projectPublicState(state, 1, "p2");
        expect(
            forOwner.players[1].exile.find((c) => c.id === "taken")!
                .legalActions
        ).toContain("cast");

        // …and one mana less is not enough, which is what proves the assertion
        // above is reading the TAXED price and not the printed {1}{G}.
        state.players[1].manaPool.G = 3;
        expect(
            getLegalActions(state, state.players[1], exiled, false, "p2")
        ).not.toContain("cast");
    });

    it("still looks when the hand holds no legal exile candidate — no pick is raised (CR 608.2b)", () => {
        const land = makeInstance(PLAINS_ID, {
            id: "landOnly",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
            types: ["Land"],
        });
        const state = setup([land], 0);
        putTriggerOnStack(state);
        expect(resolveTopOfStack(state)).not.toBeNull(); // never suspends

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].exile).toHaveLength(0);
        // The look is its own game action and happened anyway.
        expect(state.players[1].hand[0].knownTo).toEqual(["p1"]);
        expect(projectPublicState(state, 1, "p1").players[1].hand[0]?.id).toBe(
            "landOnly"
        );
    });

    it("taxes only the exiled card — another copy cast from hand pays its printed cost", () => {
        const state = setup([bear("kept"), bear("taken")], 3);
        putTriggerOnStack(state);
        resolveTopOfStack(state);
        answer(state, ["taken"]);

        const kept = state.players[1].hand.find((c) => c.id === "kept")!;
        expect(kept.castFromExileCostIncrease).toBeUndefined();
        expect(
            getLegalActions(state, state.players[1], kept, false, "p2")
        ).toContain("cast");
    });
});
