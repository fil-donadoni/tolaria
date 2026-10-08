// Compiled zone-change trigger heads reach the engine as REAL triggers
// (issue #4546, CR 603.6c / 400.7e / 404.1 / 603.2).
//
// `oracle/__tests__/zoneChangeTriggerHeads.test.ts` proves the Oracle text
// lowers to the right descriptor. It cannot prove the rebuilt ability FIRES on
// the right departures — only for THIS Aura, only for a land put into the
// controller's graveyard by an OPPONENT's spell or ability, only for a card
// that actually landed in a graveyard from any route — nor that "that card"
// finds the new object it became. So each test compiles a real Oracle row,
// registers it, and drives it through the engine: the real zone-change
// primitives, the real trigger scan, the real stack, the real resolution.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import {
    destroyWithReplacements,
    discardToGraveyard,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
} from "../state";

function register(
    id: string,
    card: ReturnType<typeof oracleCard>
): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    const definition = {
        ...outcome.definition,
        id,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const RANCOR = register(
    "test-4546-rancor",
    oracleCard({
        name: "Rancor",
        manaCost: "{G}",
        typeLine: "Enchantment — Aura",
        oracleText:
            "When this Aura is put into a graveyard from the battlefield, return it to its owner's hand.",
    })
);

const SACRED_GROUND = register(
    "test-4546-sacred-ground",
    oracleCard({
        name: "Sacred Ground",
        manaCost: "{1}{W}",
        typeLine: "Enchantment",
        oracleText:
            "Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return that card to the battlefield.",
    })
);

const PLANAR_VOID = register(
    "test-4546-planar-void",
    oracleCard({
        name: "Planar Void",
        manaCost: "{B}",
        typeLine: "Enchantment",
        oracleText:
            "Whenever another card is put into a graveyard from anywhere, exile that card.",
    })
);

const COMPOST = register(
    "test-4546-compost",
    oracleCard({
        name: "Compost",
        manaCost: "{1}{G}",
        typeLine: "Enchantment",
        oracleText:
            "Whenever a black card is put into an opponent's graveyard from anywhere, you may draw a card.",
    })
);

const plains = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed");
const darkRitual = getDefinition("ebb6664d-23ca-456e-9916-afcd6f26aa7f");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const hypnoticSpecter = getDefinition("b43b900f-2d9b-442b-9699-058483604ec9");

const on = (cardId: string, id: string, owner: string, zone = "battlefield") =>
    makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: zone as "battlefield",
    });

const triggersOf = (state: GameState, definition: CardDefinition) => {
    processPendingActionTriggers(state);
    return state.stack.filter((i) =>
        definition.compiledTriggeredAbilities?.some(
            (t) => t.id === i.triggeredAbilityId
        )
    );
};

describe("'When this Aura is put into a graveyard from the battlefield' (CR 603.6c)", () => {
    it("returns the Aura itself to its owner's hand from the graveyard it went to (CR 400.7e)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on(RANCOR.id, "aura", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "aura", "graveyard");
        expect(triggersOf(state, RANCOR)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["aura"]);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("does not fire when the Aura is exiled instead (it never reached a graveyard)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on(RANCOR.id, "aura", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "aura", "exile");
        expect(triggersOf(state, RANCOR)).toHaveLength(0);
    });

    it("does not fire for ANOTHER permanent going to a graveyard", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        on(RANCOR.id, "aura", "p1"),
                        on(grizzlyBears.id, "bears", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "bears", "graveyard");
        expect(triggersOf(state, RANCOR)).toHaveLength(0);
    });
});

describe("Sacred Ground: a land put into YOUR graveyard by an opponent's spell or ability (CR 603.2 / 404.1)", () => {
    function board() {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        on(SACRED_GROUND.id, "sg", "p1"),
                        on(plains.id, "land", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("returns the land when an opponent's spell destroys it", () => {
        const state = board();
        destroyWithReplacements(state, "land", { causerControllerId: "p2" });
        expect(triggersOf(state, SACRED_GROUND)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("land");
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "land"
        );
    });

    it("does not fire when the controller sacrifices their own land (no opponent cause)", () => {
        const state = board();
        removePermanentTo(state, "land", "graveyard", "sacrifice", "p1");
        expect(triggersOf(state, SACRED_GROUND)).toHaveLength(0);
    });

    it("does not fire for a land that goes to the graveyard with no spell or ability behind it", () => {
        const state = board();
        removePermanentTo(state, "land", "graveyard");
        expect(triggersOf(state, SACRED_GROUND)).toHaveLength(0);
    });

    it("does not fire for a NON-land permanent", () => {
        const state = board();
        state.players[0].battlefield.push(on(grizzlyBears.id, "bears", "p1"));
        destroyWithReplacements(state, "bears", { causerControllerId: "p2" });
        expect(triggersOf(state, SACRED_GROUND)).toHaveLength(0);
    });

    it("does not fire for an opponent's land (it goes to THEIR graveyard)", () => {
        const state = board();
        state.players[1].battlefield.push(on(plains.id, "their-land", "p2"));
        destroyWithReplacements(state, "their-land", {
            causerControllerId: "p2",
        });
        expect(triggersOf(state, SACRED_GROUND)).toHaveLength(0);
    });

    it("fires for a land the opponent controls but YOU own (the graveyard is the owner's, CR 404.1)", () => {
        const state = board();
        const stolen = makeInstance(plains.id, {
            id: "stolen",
            controllerId: "p2",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(stolen);
        destroyWithReplacements(state, "stolen", { causerControllerId: "p2" });
        expect(triggersOf(state, SACRED_GROUND)).toHaveLength(1);
    });
});

describe("Planar Void: 'another card … from anywhere' (CR 603.6c)", () => {
    function board(p2Hand: ReturnType<typeof makeInstance>[] = []) {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on(PLANAR_VOID.id, "void", "p1")],
                }),
                makePlayer("p2", { hand: p2Hand }),
            ],
        });
    }

    it("exiles a permanent card that dies, from the graveyard it reached", () => {
        const state = board();
        state.players[1].battlefield.push(on(grizzlyBears.id, "bears", "p2"));
        removePermanentTo(state, "bears", "graveyard");
        expect(triggersOf(state, PLANAR_VOID)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain("bears");
    });

    it("exiles a discarded card", () => {
        const state = board([on(grizzlyBears.id, "bears", "p2", "hand")]);
        discardToGraveyard(state, "p2", "bears", {
            kind: "effect",
            controllerId: "p2",
        });
        expect(triggersOf(state, PLANAR_VOID)).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[1].exile.map((c) => c.id)).toContain("bears");
    });

    it("exiles a spell card that resolves off the stack", () => {
        const state = board();
        pushSpell(state, darkRitual.id, "p2");
        resolveTopOfStack(state);
        expect(triggersOf(state, PLANAR_VOID).length).toBeGreaterThan(0);
    });

    it("does not fire for ITS OWN trip to a graveyard ('another')", () => {
        const state = board();
        removePermanentTo(state, "void", "graveyard");
        expect(triggersOf(state, PLANAR_VOID)).toHaveLength(0);
    });
});

describe("Compost: 'a black card … an opponent's graveyard' (CR 105.2 / 400.3)", () => {
    function board() {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [on(COMPOST.id, "compost", "p1")],
                    library: [on(grizzlyBears.id, "lib-1", "p1", "library")],
                }),
                makePlayer("p2", {
                    hand: [
                        on(hypnoticSpecter.id, "specter", "p2", "hand"),
                        on(grizzlyBears.id, "bears", "p2", "hand"),
                    ],
                }),
            ],
        });
    }
    const discard = (state: GameState, id: string) =>
        discardToGraveyard(state, "p2", id, {
            kind: "effect",
            controllerId: "p2",
        });

    it("fires for an opponent's black card, not for a green one", () => {
        const state = board();
        discard(state, "bears");
        expect(triggersOf(state, COMPOST)).toHaveLength(0);
        discard(state, "specter");
        expect(triggersOf(state, COMPOST)).toHaveLength(1);
    });

    it("does not fire for a black card reaching its controller's OWN graveyard", () => {
        const state = board();
        state.players[0].hand.push(
            on(hypnoticSpecter.id, "mine", "p1", "hand")
        );
        discardToGraveyard(state, "p1", "mine", {
            kind: "effect",
            controllerId: "p1",
        });
        expect(triggersOf(state, COMPOST)).toHaveLength(0);
    });
});
