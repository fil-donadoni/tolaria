// Coldsnap (CSP) — colorless card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { mishrasBauble } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";

const FOREST = getCardByName("Forest").id;

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
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

describe("Mishra's Bauble (free sac + next-upkeep cantrip, CR 603.7d)", () => {
    it("is a {0} artifact carrying the next-upkeep delayed trigger", () => {
        expect(getCardByName("Mishra's Bauble")).toBe(mishrasBauble);
        expect(mishrasBauble.manaCost).toEqual({});
        expect(mishrasBauble.delayedTriggers?.[0]?.timing).toBe("next-upkeep");
        const ability = mishrasBauble.activatedAbilities![0];
        expect(ability.cost).toMatchObject({ tap: true, sacrifice: true });
        expect(ability.targetRequirement).toEqual({ type: "player", count: 1 });
    });

    it("schedules the next-upkeep draw when activated (no immediate draw)", () => {
        const bauble = makeInstance(mishrasBauble.id, {
            id: "bauble",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(FOREST, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bauble], library: lib }),
                makePlayer("p2", { library: [] }),
            ],
        });
        resolveActivated(state, bauble, "mishras-bauble-look", [
            { type: "player", id: "p2" },
        ]);
        // CR 603.7d — the draw is delayed, not immediate.
        expect(state.players[0].hand.length).toBe(0);
        expect((state.delayedTriggers ?? []).length).toBeGreaterThan(0);
    });
});
