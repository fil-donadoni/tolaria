// RNA — blue card tests (ADR 0043 per-colour split). Skitter Eel is the
// prover card for Adapt N (CR 701.46, issue #1316, split from #917): its
// activated ability is built entirely from the `adaptAbility` factory
// (`convex/cards/abilities/adapt.ts`), whose `effects` script combines the
// `if` structural construct with a `counters`-of-`$source` comparison
// predicate — a combination the catalogue-wide DSL smoke sweep
// (`effectScriptSmoke.test.ts`) explicitly SKIPS ("construct 'if' branches
// on a runtime predicate — covered by the card's own tests"), which is
// exactly the signal (`.claude/rules/gre-development.md` § DSL-first
// authoring) to add this hand-written test.

import { describe, it, expect } from "vitest";
import { skitterEel } from "..";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

/** Pushes an activated ability directly onto the stack (bypassing cost
 *  payment, which `adaptAbility` doesn't special-case) and resolves it. */
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

describe("Skitter Eel — Adapt 2 (CR 701.46)", () => {
    it("puts N +1/+1 counters on itself when it has none", () => {
        const eel = makeInstance(skitterEel.id, { id: "eel" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eel] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, eel, "skitter-eel-adapt");
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "eel"
        )!;
        expect(onBoard.counters?.["+1/+1"]).toBe(2);
    });

    it("CR 701.46a gate — does nothing when it already has a +1/+1 counter", () => {
        const eel = makeInstance(skitterEel.id, {
            id: "eel-2",
            counters: { "+1/+1": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eel] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, eel, "skitter-eel-adapt");
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "eel-2"
        )!;
        // Adapt is a no-op — the counter count is unchanged (CR 701.46a: "If
        // this creature has NO +1/+1 counters on it" — one is not none).
        expect(onBoard.counters?.["+1/+1"]).toBe(1);
    });

    it("the added counters survive the wire projection (visible board state)", () => {
        const eel = makeInstance(skitterEel.id, { id: "eel-3" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eel] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, eel, "skitter-eel-adapt");
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "eel-3"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(2);
    });
});
