// Frontend wiring for the `exileFilter` activation cost (CR 602.1a / 118.3 /
// 701.13a — City of Shadows' "{T}, Exile a creature you control: Put a storage
// counter on this land.").
//
// The server refuses the activation with no matching permanent; the client must
// not offer it either, or the click dispatches a doomed activation. Two
// surfaces read the leg: `getStackAbilities` (the ability menu) and
// `describeSacrificeChoice` (the banner over the parked pick, which must say
// "exile", not "sacrifice").
//
// Every assertion starts from a real engine state and goes through
// `projectPublicState` and `buildTriggerStateView` — the reducers the board
// reads — never a hand-built view.

import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { activateAbilityOnState } from "@convex/gre/activation";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import type { CardInstance } from "../../types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";
import { describeSacrificeChoice } from "../sacrifice-selection";

const VIEWER = "p1";
const CITY = getCardByName("City of Shadows").id;
const ELF = getCardByName("Llanowar Elves").id;
const FOREST = getCardByName("Forest").id;
const STORE = "city-of-shadows-store";

function inst(
    defId: string,
    id: string,
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: VIEWER,
        ownerId: VIEWER,
        ...extra,
    });
}

function engineState(battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer(VIEWER, { battlefield }), makePlayer("p2")],
    });
}

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
        (c) => c.id === "city"
    ) as CardInstance;
    return { projected, view, source };
}

function offeredIds(state: GameState): string[] {
    const { view, source } = clientView(state);
    return getStackAbilities(source, "PRECOMBAT_MAIN", true, view, 20).map(
        (a) => a.id
    );
}

describe("exileFilter — the ability menu gate (CR 118.3)", () => {
    it("offers the ability while the viewer controls a creature", () => {
        const state = engineState([inst(CITY, "city"), inst(ELF, "elf")]);
        expect(offeredIds(state)).toContain(STORE);
    });

    it("hides it with no creature — a Forest is no payment", () => {
        const state = engineState([inst(CITY, "city"), inst(FOREST, "forest")]);
        expect(offeredIds(state)).not.toContain(STORE);
    });

    it("hides it when the only creature is the OPPONENT's", () => {
        const state = engineState([inst(CITY, "city")]);
        state.players[1].battlefield.push(
            makeInstance(ELF, {
                id: "opp-elf",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        expect(offeredIds(state)).not.toContain(STORE);
    });
});

describe("exileFilter — the parked pick's banner", () => {
    it("asks the viewer to EXILE, read off the projected selection", () => {
        const state = engineState([
            inst(CITY, "city"),
            inst(ELF, "elf-1"),
            inst(ELF, "elf-2", { isTapped: true }),
        ]);
        activateAbilityOnState(state, {
            playerId: VIEWER,
            cardInstanceId: "city",
            abilityId: STORE,
        });

        const sel =
            clientView(state).projected.pendingActivation?.sacrificeSelection;
        expect(sel).toBeDefined();
        expect(describeSacrificeChoice(sel!)).toMatch(/^exile a creature/);
    });
});
