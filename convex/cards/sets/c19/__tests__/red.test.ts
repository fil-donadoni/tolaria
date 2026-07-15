// Per-card behavior tests for red cards in `convex/cards/sets/c19/red.ts`
// (Commander 2019, split by colour per ADR 0043). The Madness capability is
// exercised in `convex/gre/__tests__/madness.test.ts`; here we pin Anje's
// Ravager's definition + its attack trigger (discard your hand, then draw 3).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { getPlayer, resolveTopOfStack } from "../../../../gre/state";
import { getCardByName } from "../../../index";
import { anjesRavager } from "../red";

/** Push a triggered ability onto the stack with its firing event, then resolve. */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

describe("Anje's Ravager — Madness {1}{R}, must-attack, attack-wheel (CR 702.35 / 508.1d)", () => {
    it("carries Madness {1}{R} and an attack-requirement static effect", () => {
        expect(anjesRavager.madness).toEqual({ X: 1, R: 1 });
        expect(
            anjesRavager.staticEffects?.some(
                (e) => e.kind === "attack-requirement"
            )
        ).toBe(true);
    });

    it("discards the controller's hand, then draws three, on attack", () => {
        const ravager = makeInstance(anjesRavager.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bear = getCardByName("Grizzly Bears");
        const hand = [
            makeInstance(bear.id, { id: "h1", ownerId: "p1", zone: "hand" }),
            makeInstance(bear.id, { id: "h2", ownerId: "p1", zone: "hand" }),
        ];
        // A stocked library so the three-card draw is real.
        const library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(bear.id, {
                id: `lib${i}`,
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [ravager],
                    hand,
                    library,
                }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
        });

        resolveTrigger(state, ravager, "anjes-ravager-attack-wheel", {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: "p1",
            attackerIds: [ravager.id],
        } as StackItem["triggerEvent"]);

        const p1 = getPlayer(state, "p1");
        // Discarded the two hand cards (they are non-madness → graveyard) …
        expect(p1.graveyard.filter((c) => c.id.startsWith("h")).length).toBe(2);
        // … then drew exactly three from the library.
        expect(p1.hand.length).toBe(3);
        expect(p1.library.length).toBe(2);
    });
});
