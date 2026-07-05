// TLA — colorless card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { abandonedAirTemple } from "../colorless";
import { island } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import { getPlayer, resolveTopOfStack } from "../../../../gre/state";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState, StackItem } from "../../../../gre/state";

/** Pushes an activated ability onto the stack with its cost assumed already
 *  paid (mirrors post-`activateAbility` state), then resolves it. Mirrors the
 *  established `resolveActivated` shim (`sets/atq/__tests__/helpers.ts`). */
function resolveActivated(
    state: GameState,
    sourceId: string,
    controllerId: string,
    abilityId: string
): void {
    const source = state.players
        .find((p) => p.id === controllerId)!
        .battlefield.find((c) => c.id === sourceId)!;
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: controllerId,
        abilityId,
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

// Abandoned Air Temple — Land (CR 614.1c conditional tapped entry; CR 605.1a
// mana ability; CR 122 mass counter placement). "This land enters tapped
// unless you control a basic land.\n{T}: Add {W}.\n{3}{W}, {T}: Put a +1/+1
// counter on each creature you control."
describe("Abandoned Air Temple (CR 614.1c conditional tapped entry; CR 605.1a mana; CR 122 mass counters)", () => {
    it("enters UNTAPPED when you control a basic land", () => {
        const basic = makeInstance(island.id, { id: "isl" });
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [basic], hand: [temple] }),
                makePlayer("p2"),
            ],
        });
        const played = applyPlayLand(state, getPlayer(state, "p1"), "temple");
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED when you control no basic land", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [temple] }), makePlayer("p2")],
        });
        const played = applyPlayLand(state, getPlayer(state, "p1"), "temple");
        expect(played.isTapped).toBe(true);
    });

    it("{T}: Add {W}", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [temple] }), makePlayer("p2")],
        });
        resolveActivated(state, "temple", "p1", "abandoned-air-temple-mana");
        expect(getPlayer(state, "p1").manaPool.W).toBe(1);
    });

    it("{3}{W}, {T}: puts a +1/+1 counter on each creature you control, not the opponent's", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(abandonedAirTemple.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const oppBear = makeInstance(abandonedAirTemple.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [temple, bear] }),
                makePlayer("p2", { battlefield: [oppBear] }),
            ],
        });
        resolveActivated(state, "temple", "p1", "abandoned-air-temple-counters");
        const bearLive = state.players[0].battlefield.find((c) => c.id === "bear")!;
        const oppLive = state.players[1].battlefield.find((c) => c.id === "opp-bear")!;
        expect(bearLive.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, bearLive)).toBe(3);
        expect(oppLive.counters?.["+1/+1"]).toBeUndefined();
        // The land itself isn't a creature — no counter on it.
        const templeLive = state.players[0].battlefield.find((c) => c.id === "temple")!;
        expect(templeLive.counters?.["+1/+1"]).toBeUndefined();
    });

    it("wire format: the mass +1/+1 counters survive projectPublicState", () => {
        const temple = makeInstance(abandonedAirTemple.id, {
            id: "temple",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(abandonedAirTemple.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [temple, bear] }), makePlayer("p2")],
        });
        resolveActivated(state, "temple", "p1", "abandoned-air-temple-counters");
        const projected = projectPublicState(state, 1, "p1");
        const bearLive = projected.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(projected, bearLive)).toBe(3);
    });
});
