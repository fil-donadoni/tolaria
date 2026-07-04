// Per-card behavior tests for colorless cards in `convex/cards/sets/dsk/colorless.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { thornspireVerge, blazemireVerge } from "..";
import { makeInstance, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import type { GameState, CardInstanceState } from "../../../../gre/state";

const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const SWAMP = getCardByName("Swamp").id;

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

describe("Thornspire Verge (CR 605.1a mana ability; CR 602.5b activation restriction)", () => {
    it("has no entersTapped / entersTappedUnless — the Verge cycle enters untapped unconditionally", () => {
        expect(thornspireVerge.entersTapped).toBeUndefined();
        expect(thornspireVerge.entersTappedUnless).toBeUndefined();
    });

    it("offers only the primary colour when the controller controls neither unlock subtype", () => {
        const land = makeInstance(thornspireVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }]);
    });

    it("unlocks the secondary colour once the controller controls a Mountain", () => {
        const land = makeInstance(thornspireVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            land,
            makeInstance(MOUNTAIN, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }, { G: 1 }]);
    });

    it("unlocks the secondary colour once the controller controls a Forest (OR, not AND)", () => {
        const land = makeInstance(thornspireVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            land,
            makeInstance(FOREST, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }, { G: 1 }]);
    });

    it("scopes the unlock check to the ACTIVATING PLAYER's own battlefield — an opponent's Forest does not unlock it", () => {
        const land = makeInstance(thornspireVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        state.players[1].battlefield = [
            makeInstance(FOREST, { controllerId: "p2" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ R: 1 }]);
    });
});

describe("Blazemire Verge (CR 605.1a / 602.5b)", () => {
    it("B primary, R secondary, unlocked by Swamp or Mountain", () => {
        const land = makeInstance(blazemireVerge.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [land];
        expect(manaChoices(state, land, "p1")).toEqual([{ B: 1 }]);

        state.players[0].battlefield = [
            land,
            makeInstance(SWAMP, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ B: 1 }, { R: 1 }]);

        state.players[0].battlefield = [
            land,
            makeInstance(MOUNTAIN, { controllerId: "p1" }),
        ];
        expect(manaChoices(state, land, "p1")).toEqual([{ B: 1 }, { R: 1 }]);
    });
});
