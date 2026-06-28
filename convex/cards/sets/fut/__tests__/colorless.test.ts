// FUT (Future Sight) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { horizonCanopy } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type CardInstanceState,
} from "../../../../gre/state";

/** Push an activated ability onto the stack (cost assumed already paid) and
 *  resolve it — mirrors post-`activateAbility` state. */
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
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Horizon Canopy (painland cantrip, CR 605.1a / 305)", () => {
    it("is a Land with a pay-life dual mana ability and a sacrifice cantrip", () => {
        expect(horizonCanopy.types).toEqual(["Land"]);
        expect(horizonCanopy.manaCost).toBeUndefined();
        const mana = horizonCanopy.activatedAbilities!.find(
            (a) => a.id === "horizon-canopy-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.cost).toMatchObject({ tap: true, life: 1 });
        expect(mana.manaChoices).toEqual([{ G: 1 }, { W: 1 }]);
        const draw = horizonCanopy.activatedAbilities!.find(
            (a) => a.id === "horizon-canopy-draw"
        )!;
        expect(draw.cost).toMatchObject({
            mana: { X: 1 },
            tap: true,
            sacrifice: true,
        });
    });

    it("the cantrip ability draws a card on resolution (CR 121.1)", () => {
        const land = makeInstance(horizonCanopy.id, {
            id: "canopy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const lib = makeInstance(horizonCanopy.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land], library: [lib] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, "horizon-canopy-draw");
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });
});
