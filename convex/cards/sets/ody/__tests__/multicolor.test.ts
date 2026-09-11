// ODY (Odyssey) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const psychatog = getDefinition("6757bf0e-489f-4be2-9e41-463b59f00dd1");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

/** Puts an already-PAID activation of `abilityId` on the stack and resolves
 *  it. The cost-payment machinery itself (the discard-filter picker, the
 *  exile-from-graveyard picker) is exercised generically in
 *  `gre/__tests__/` and by `activation-affordability.catalogue.test.ts`;
 *  what is unproven for THIS card is the effect, which is exactly why the
 *  smoke generator skips it ("Op \"pump\" targets $source/$each"). */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...structuredClone(source),
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

const tog = () =>
    makeInstance(psychatog.id, {
        id: "tog",
        controllerId: "p1",
        ownerId: "p1",
    });

// Psychatog — hand-written precisely BECAUSE the generated smoke test cannot
// scenario-ize a `pump` that targets `$source`; the quarantine reason names
// this file. Both abilities pump the SOURCE, so the assertion that matters is
// that the buff lands on the Psychatog itself and stacks across activations.
describe("Psychatog (self-pump, CR 602.2b / 613.4c layer 7c)", () => {
    it("the discard ability gives the Psychatog itself +1/+1", () => {
        const source = tog();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "psychatog-ability");
        const live = state.players[0].battlefield.find((c) => c.id === "tog")!;
        expect(getEffectivePower(state, live)).toBe(2); // 1 + 1
        expect(getEffectiveToughness(state, live)).toBe(3); // 2 + 1
    });

    it("the graveyard-exile ability pumps the same way, and the two stack", () => {
        const source = tog();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "psychatog-ability");
        resolveActivated(state, source, "psychatog-ability-2");
        const live = state.players[0].battlefield.find((c) => c.id === "tog")!;
        // CR 613.4c — two independent layer-7c effects, both applied.
        expect(getEffectivePower(state, live)).toBe(3); // 1 + 1 + 1
        expect(getEffectiveToughness(state, live)).toBe(4); // 2 + 1 + 1
    });

    it("pumps ONLY itself — another creature beside it is untouched", () => {
        const source = tog();
        const bystander = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source, bystander] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "psychatog-ability");
        const bears = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(getEffectivePower(state, bears)).toBe(2); // unchanged
        expect(getEffectiveToughness(state, bears)).toBe(2);
    });

    // A `pump` outcome is visible on the board, so the projection has to carry
    // it: the reducer strips `card.card` to `{ id }` and reshapes arrays, and
    // a GRE-only assertion would pass on a client that renders 1/2.
    it("the buff survives the wire-format projection", () => {
        const source = tog();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, source, "psychatog-ability-2");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tog"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});
