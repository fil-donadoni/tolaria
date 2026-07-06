// Per-card behavior tests for black cards in `convex/cards/sets/plc/black.ts`
// (Planar Chaos, split by colour per ADR 0043). Damnation is a `resolve()`
// card (NOT DSL-migratable — see the justification comment on the card
// itself): it mirrors Wrath of God's "destroy all creatures, can't be
// regenerated" shape (CR 701.8 / 701.15c) via the shared
// `SpellContext.destroyAll` primitive, so its test suite mirrors
// `convex/cards/sets/lea/__tests__/white.test.ts`'s Wrath of God block.

import { describe, it, expect } from "vitest";
import { damnation } from "..";
import { savannahLions, serraAngel } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";

describe("Damnation (destroy all creatures, can't be regenerated, CR 701.15c)", () => {
    it("moves every creature to its owner's graveyard", () => {
        const angel = makeInstance(serraAngel.id, { id: "angel" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, damnation.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("angel");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });

    it("regeneration shields are NOT consumed — the rider suppresses them", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, damnation.id, "p1");
        resolveTopOfStack(state);
        // Lion in graveyard, not in play — Damnation bypassed the shield.
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "lion")
        ).toBeDefined();
    });

    it("indestructible creatures still survive (CR 702.12)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, damnation.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "lion")
        ).toBeDefined();
    });
});
