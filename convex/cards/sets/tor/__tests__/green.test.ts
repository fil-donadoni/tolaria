// Per-card behavior tests for green cards in `convex/cards/sets/tor/green.ts`
// (Torment, split by colour per ADR 0043). The Madness capability itself is
// exercised once in `convex/gre/__tests__/madness.test.ts`; here we pin
// Basking Rootwalla's definition + its once-per-turn pump.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup";
import type { CardInstanceState, GameState, StackItem } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { baskingRootwalla } from "../green";

/** Push an activated ability onto the stack (cost assumed paid), then resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

describe("Basking Rootwalla — Madness {0} + once-per-turn pump (CR 702.35 / 602.5)", () => {
    it("carries Madness {0} and a oncePerTurn pump ability", () => {
        expect(baskingRootwalla.madness).toEqual({});
        const pump = baskingRootwalla.activatedAbilities?.find(
            (a) => a.id === "basking-rootwalla-pump"
        );
        expect(pump?.oncePerTurn).toBe(true);
    });

    it("gives +2/+2 until end of turn, surviving the wire projection", () => {
        const walla = makeInstance(baskingRootwalla.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [walla] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, walla, "basking-rootwalla-pump");
        // Fat state: 1/1 → 3/3.
        expect(getEffectivePower(state, walla)).toBe(3);
        expect(getEffectiveToughness(state, walla)).toBe(3);
        // Wire: the buff survives projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === walla.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});
