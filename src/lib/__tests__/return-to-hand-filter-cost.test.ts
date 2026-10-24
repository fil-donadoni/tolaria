// Frontend wiring for the `returnToHandFilter` activation cost (CR 602.1a /
// 118.3 — "Return an Elf you control to its owner's hand", Wirewood Symbiote).
//
// The server refuses the activation with no matching permanent; the client must
// not offer it either, or the click dispatches a doomed activation. Three
// surfaces read the leg: `getStackAbilities` (the ability menu),
// `getManaCostMenuAbility` (a `useStack: false` ability carrying the leg) and
// `describeSacrificeChoice` (the banner over the parked pick, which must say
// "return", not "sacrifice").
//
// Every assertion starts from a real engine state and goes through
// `projectPublicState` and `buildTriggerStateView` — the reducers the board
// reads — never a hand-built view.

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "@convex/cards/types";
import { getCardByName, preloadDefinitions } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { activateAbilityOnState } from "@convex/gre/activation";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { CardInstance } from "../../types/game";
import {
    buildTriggerStateView,
    getManaCostMenuAbility,
    getStackAbilities,
} from "../card-utils";
import { describeSacrificeChoice } from "../sacrifice-selection";

const VIEWER = "p1";
const ELF = getCardByName("Llanowar Elves").id;
const FOREST = getCardByName("Forest").id;
const SYMBIOTE_ID = "00000000-0000-4000-8000-000065000021";
const MANA_ID = "00000000-0000-4000-8000-000065000022";

preloadDefinitions([
    {
        id: SYMBIOTE_ID,
        name: "Synthetic Client Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "symbiote-gain",
                oracleText:
                    "Return an Elf you control to its owner's hand: You gain 3 life.",
                cost: { returnToHandFilter: { subtypes: ["Elf"] } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        id: MANA_ID,
        name: "Synthetic Client Land Bouncer",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "bouncer-mana",
                oracleText:
                    "Return a land you control to its owner's hand: Add {G}.",
                cost: { returnToHandFilter: { types: ["Land"] } },
                useStack: false,
                manaProduced: { G: 1 },
            },
        ],
    } as CardDefinition,
]);

function inst(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, { id, controllerId: VIEWER, ownerId: VIEWER });
}

function engineState(battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer(VIEWER, { battlefield }), makePlayer("p2")],
    });
}

/** The projected source card and the trigger view built from the projection. */
function clientView(state: GameState) {
    const projected = projectPublicState(state, 1, VIEWER);
    const view = buildTriggerStateView(
        projected.players.map((p) => ({
            id: p.id,
            life: p.life,
            hand: (p.hand ?? []) as CardInstance[],
            battlefield: p.battlefield as CardInstance[],
            graveyard: p.graveyard as CardInstance[],
        })),
        VIEWER
    );
    const source = projected.players[0].battlefield.find(
        (c) => c.id === "src"
    ) as CardInstance;
    return { projected, view, source };
}

function offeredIds(state: GameState): string[] {
    const { view, source } = clientView(state);
    return getStackAbilities(source, "PRECOMBAT_MAIN", true, view, 20).map(
        (a) => a.id
    );
}

describe("returnToHandFilter — the ability menu gate (CR 118.3)", () => {
    it("offers the ability while the viewer controls an Elf", () => {
        const state = engineState([inst(SYMBIOTE_ID, "src"), inst(ELF, "elf")]);
        expect(offeredIds(state)).toContain("symbiote-gain");
    });

    it("hides it with no Elf — a Forest is no payment", () => {
        const state = engineState([
            inst(SYMBIOTE_ID, "src"),
            inst(FOREST, "forest"),
        ]);
        expect(offeredIds(state)).not.toContain("symbiote-gain");
    });

    it("hides it when the only Elf is the OPPONENT's", () => {
        const state = engineState([inst(SYMBIOTE_ID, "src")]);
        state.players[1].battlefield.push(
            makeInstance(ELF, {
                id: "opp-elf",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        expect(offeredIds(state)).not.toContain("symbiote-gain");
    });
});

describe("returnToHandFilter — the mana-ability menu gate (CR 605.1a)", () => {
    it("offers a `useStack: false` ability only while a land can be returned", () => {
        const withLand = clientView(
            engineState([inst(MANA_ID, "src"), inst(FOREST, "forest")])
        );
        expect(getManaCostMenuAbility(withLand.source, withLand.view)?.id).toBe(
            "bouncer-mana"
        );

        const without = clientView(engineState([inst(MANA_ID, "src")]));
        expect(getManaCostMenuAbility(without.source, without.view)).toBeNull();
    });
});

describe("returnToHandFilter — the parked pick's banner", () => {
    it("asks the viewer to RETURN, read off the projected selection", () => {
        const state = engineState([
            inst(SYMBIOTE_ID, "src"),
            inst(ELF, "elf-1"),
            { ...inst(ELF, "elf-2"), isTapped: true },
        ]);
        activateAbilityOnState(state, {
            playerId: VIEWER,
            cardInstanceId: "src",
            abilityId: "symbiote-gain",
        });

        const sel =
            clientView(state).projected.pendingActivation?.sacrificeSelection;
        expect(sel).toBeDefined();
        expect(describeSacrificeChoice(sel!)).toMatch(/^return /);
    });
});
