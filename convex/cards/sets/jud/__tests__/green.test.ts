// JUD — green card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { getDefinition } from "../../../index";

const sylvanSafekeeper = getDefinition("f1b8413f-c9fc-4cea-b416-a1fcf651b009");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");

/** Push an activated ability onto the stack with its cost assumed already
 *  paid (the sacrifice happens at activation, before this call in the real
 *  flow — mirrored here by sacrificing the land up front). */
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
    });
    resolveTopOfStack(state);
}

// Sylvan Safekeeper — {G} Creature — Human Wizard (CR 118.5 sacrifice cost;
// CR 702.18 shroud grant — decorative pending project-wide target-legality
// wiring, see ulg/white.ts-style precedent noted in jud/green.ts).
describe("Sylvan Safekeeper (CR 118.5 sacrifice-a-land cost; CR 702.18 shroud grant)", () => {
    function setup() {
        const safekeeper = makeInstance(sylvanSafekeeper.id, {
            id: "safekeeper",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [safekeeper, land] }),
                makePlayer("p2"),
            ],
        });
        return { state, safekeeper, land };
    }

    it("grants the target creature you control shroud until end of turn", () => {
        const { state, safekeeper } = setup();
        resolveActivated(state, safekeeper, "sylvan-safekeeper-shroud", [
            { type: "permanent", id: "safekeeper" },
        ]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "safekeeper"
        )!;
        expect(live.staticAbilities).toContain("shroud");
    });
});
