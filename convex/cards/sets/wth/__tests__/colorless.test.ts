// Weatherlight (WTH) — colorless card behavior tests (ADR 0043 colour split).
// Each describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, getCardByName } from "../../../index";

const mindStone = getDefinition("162e81d3-6cd4-4cb8-8ed8-cfbd8d34ca71");

const FOREST = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b").id;

/** Push an activated ability onto the stack (cost assumed paid) and resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

function libraryOf(n: number, owner = "p1"): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(FOREST, {
            id: `${owner}-lib${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

describe("Mind Stone (mana rock + sacrifice cantrip, CR 605 / 121.1)", () => {
    it("registers and has a colourless {C} mana ability (useStack:false)", () => {
        expect(getCardByName("Mind Stone").id).toBe(mindStone.id);
        expect(mindStone.manaCost).toEqual({ X: 2 });
        const mana = mindStone.activatedAbilities!.find(
            (a) => a.id === "mind-stone-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 1 });
    });

    it("the sacrifice ability draws a card on resolution", () => {
        const stone = makeInstance(mindStone.id, {
            id: "stone",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [stone],
                    library: libraryOf(3),
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, stone, "mind-stone-draw");
        expect(state.players[0].hand.length).toBe(1);

        // Wire format: the drawn card survives the projection (CR 121.1).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
    });
});

const phyrexianFurnace = getDefinition("e98bca31-8c05-430b-b5d7-331bdc55710a");

/** Push an activated ability WITH announced targets and resolve it. */
function resolveActivatedWithTargets(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    } as StackItem);
    resolveTopOfStack(state);
}

/** A card in a graveyard. Graveyards are ordered OLDEST-first (CR 404.2; every
 *  insertion site pushes), so index 0 is the BOTTOM of the pile. */
function gyCard(id: string, owner: string): CardInstanceState {
    return makeInstance(FOREST, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });
}

describe("Phyrexian Furnace (graveyard hate, CR 404.2 / 601.2c / 605)", () => {
    function furnaceState(p2Graveyard: CardInstanceState[]) {
        const furnace = makeInstance(phyrexianFurnace.id, {
            id: "furnace",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [furnace],
                    library: libraryOf(3),
                    graveyard: [gyCard("mine", "p1")],
                }),
                makePlayer("p2", { graveyard: p2Graveyard }),
            ],
        });
        return { state, furnace };
    }

    it("exiles the BOTTOM (oldest) card of the target player's graveyard", () => {
        const { state, furnace } = furnaceState([
            gyCard("oldest", "p2"),
            gyCard("middle", "p2"),
            gyCard("newest", "p2"),
        ]);
        resolveActivatedWithTargets(
            state,
            furnace,
            "phyrexian-furnace-exile-bottom",
            [{ type: "player", id: "p2" }]
        );
        // CR 404.2 — the pile is ordered; the BOTTOM is the oldest entry, not
        // the most recent one.
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["oldest"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "middle",
            "newest",
        ]);
        // The controller's own bin is untouched — the ability names a target.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
    });

    it("an empty target graveyard is a clean CR 609.3 no-op", () => {
        const { state, furnace } = furnaceState([]);
        resolveActivatedWithTargets(
            state,
            furnace,
            "phyrexian-furnace-exile-bottom",
            [{ type: "player", id: "p2" }]
        );
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
    });

    it("the sacrifice ability exiles the announced graveyard card and draws", () => {
        const { state, furnace } = furnaceState([
            gyCard("a", "p2"),
            gyCard("b", "p2"),
        ]);
        resolveActivatedWithTargets(
            state,
            furnace,
            "phyrexian-furnace-exile-draw",
            [{ type: "graveyard-card", id: "b", playerId: "p2" }]
        );
        // CR 601.2c — the announced card leaves, and only that one.
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["b"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["a"]);
        expect(state.players[0].hand).toHaveLength(1);

        // MANDATORY wire format: exile and hand both survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].exile.map((c) => c.id)).toEqual(["b"]);
        expect(projected.players[0].hand).toHaveLength(1);
    });
});
