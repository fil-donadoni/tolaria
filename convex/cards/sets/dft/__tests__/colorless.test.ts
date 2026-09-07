// Per-card behavior tests for colorless cards in `convex/cards/sets/dft/colorless.ts`
// (Aetherdrift, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { makeInstance, makeState } from "../../../__tests__/setup";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import type { GameState, CardInstanceState } from "../../../../gre/state";
import { getDefinition } from "../../../index";

const riverpyreVerge = getDefinition("57a93a71-d77c-417f-85d0-cd420f573331");
const bleachboneVerge = getDefinition("52dcdabd-a186-45fe-9fee-6c0f1afeaf16");
const wastewoodVerge = getDefinition("5ceacc7d-d407-4f82-af58-9bdf8426924e");

const FOREST = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b").id;
const ISLAND = getDefinition("90a57c0e-fa61-45ef-955d-d296403967d5").id;
const PLAINS = getDefinition("b1623d57-4729-4796-b3f7-f1837a05c6ed").id;
const MOUNTAIN = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56").id;
const SWAMP = getDefinition("6176936d-72e2-4205-8871-4c5a4f1cb2d8").id;

function manaChoices(
    state: GameState,
    land: CardInstanceState,
    controllerId: string
): ReturnType<typeof getEffectiveManaChoices> {
    return getEffectiveManaChoices(
        land,
        controllerId,
        state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }))
    );
}

describe("Riverpyre Verge (CR 605.1a mana ability; CR 602.5b activation restriction)", () => {
    it("offers only the primary colour when the controller controls neither unlock subtype", () => {
        const land = makeInstance(riverpyreVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }]);
    });

    it("unlocks the secondary colour once the controller controls an Island", () => {
        const land = makeInstance(riverpyreVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            land,
            makeInstance(ISLAND, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }, { U: 1 }]);
    });

    it("unlocks the secondary colour once the controller controls a Mountain (OR, not AND)", () => {
        const land = makeInstance(riverpyreVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            land,
            makeInstance(MOUNTAIN, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }, { U: 1 }]);
    });

    it("scopes the unlock check to the ACTIVATING PLAYER's own battlefield — an opponent's Mountain does not unlock it", () => {
        const land = makeInstance(riverpyreVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        state.players[1].battlefield = [
            makeInstance(MOUNTAIN, { controllerId: "p2" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }]);
    });
});

describe("Verge cycle — Bleachbone / Wastewood (CR 605.1a / 602.5b)", () => {
    it("Bleachbone Verge: B primary, W secondary, unlocked by Plains or Swamp", () => {
        const land = makeInstance(bleachboneVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ B: 1 }]);

        state.players[0].battlefield = [
            land,
            makeInstance(PLAINS, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ B: 1 }, { W: 1 }]);

        state.players[0].battlefield = [
            land,
            makeInstance(SWAMP, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ B: 1 }, { W: 1 }]);
    });

    it("Wastewood Verge: G primary, B secondary, unlocked by Swamp or Forest", () => {
        const land = makeInstance(wastewoodVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ G: 1 }]);

        state.players[0].battlefield = [
            land,
            makeInstance(SWAMP, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ G: 1 }, { B: 1 }]);

        state.players[0].battlefield = [
            land,
            makeInstance(FOREST, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ G: 1 }, { B: 1 }]);
    });
});
