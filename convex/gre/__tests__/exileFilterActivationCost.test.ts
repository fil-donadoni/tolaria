// `cost.exileFilter` — "Exile a permanent matching <filter> you control" as an
// ACTIVATION cost (CR 602.1a — the activation cost is everything before the
// colon; CR 701.13a — exile moves the object to the exile zone; CR 602.2b —
// activating follows CR 601.2b–i, so the cost is paid as the ability is put on
// the stack, never on resolution). City of Shadows' "{T}, Exile a creature you
// control: Put a storage counter on this land."
//
// The exile twin of `cost.sacrificeFilter` / `cost.returnToHandFilter`: the
// activator CHOOSES the permanent through the one selection layer every
// give-up cost shares (`gre/sacrificeChoice.ts`), as a requirement with
// `action: "exile"`. What this file proves: the leg is gated (CR 118.3), paid
// at ACTIVATION (the creature is in exile while the ability is on the stack —
// not a target, so nothing can fizzle), chosen when the choice is real, and
// exiled to its OWNER's exile.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import { activateAbilityOnState, selectSacrificeOnState } from "../../game";
import { getPlayer, resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

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
        controllerId: "p1",
        ownerId: "p1",
        ...extra,
    });
}

function board(battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
}

const activate = (state: GameState) =>
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "city",
        abilityId: STORE,
    });

const onBattlefield = (state: GameState, id: string) =>
    state.players.some((p) => p.battlefield.some((c) => c.id === id));
const inExile = (state: GameState, playerId: string, id: string) =>
    getPlayer(state, playerId).exile.some((c) => c.id === id);
const storage = (state: GameState) =>
    getPlayer(state, "p1").battlefield.find((c) => c.id === "city")?.counters
        ?.storage ?? 0;

describe("cost.exileFilter — affordability (CR 118.3)", () => {
    it("refuses the activation with no creature to exile — a land is no payment", () => {
        const state = board([inst(CITY, "city"), inst(FOREST, "forest")]);

        expect(() => activate(state)).toThrow(/exile cost/);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation).toBeUndefined();
    });

    it("an OPPONENT's creature is no payment — the leg reads permanents YOU control", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst(CITY, "city")] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ELF, {
                            id: "opp-elf",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });

        expect(() => activate(state)).toThrow(/exile cost/);
        expect(onBattlefield(state, "opp-elf")).toBe(true);
    });
});

describe("cost.exileFilter — paid at activation, not resolution (CR 602.2b / 601.2h)", () => {
    it("the creature is in exile while the ability waits on the stack", () => {
        const state = board([inst(CITY, "city"), inst(ELF, "elf")]);

        activate(state);

        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        // Paid: gone before anyone gets priority to respond.
        expect(inExile(state, "p1", "elf")).toBe(true);
        expect(onBattlefield(state, "elf")).toBe(false);
        // An exile, never a sacrifice.
        expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
        // Not a target: the stack item names nothing to fizzle on.
        expect(state.stack[0].targets ?? []).toEqual([]);
        expect(storage(state)).toBe(0);

        resolveTopOfStack(state);
        expect(storage(state)).toBe(1);
    });

    it("exiles to its OWNER's exile, not the activating controller's", () => {
        const state = board([
            inst(CITY, "city"),
            inst(ELF, "elf", { ownerId: "p2" }),
        ]);

        activate(state);

        expect(getPlayer(state, "p2").exile.map((c) => c.id)).toEqual(["elf"]);
        expect(getPlayer(state, "p1").exile).toHaveLength(0);
    });
});

describe("cost.exileFilter — a real choice is the payer's (CR 602.1a)", () => {
    it("with two creatures, parks an EXILE pick and exiles the one chosen", () => {
        const state = board([
            inst(CITY, "city"),
            inst(ELF, "elf-1"),
            inst(ELF, "elf-2", { isTapped: true }),
        ]);

        activate(state);

        // Announced, not paid: both creatures still on the battlefield.
        const sel = state.pendingActivation?.sacrificeSelection;
        expect(sel?.requirements).toHaveLength(1);
        expect(sel?.requirements[0]).toMatchObject({
            count: 1,
            action: "exile",
        });
        expect(state.stack).toHaveLength(0);
        expect(onBattlefield(state, "elf-1")).toBe(true);
        expect(onBattlefield(state, "elf-2")).toBe(true);

        selectSacrificeOnState(state, {
            playerId: "p1",
            cardInstanceId: "elf-2",
        });

        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(inExile(state, "p1", "elf-2")).toBe(true);
        expect(onBattlefield(state, "elf-1")).toBe(true);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
    });
});
