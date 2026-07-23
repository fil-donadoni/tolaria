// Per-card tests for c14/white.ts. Containment Priest ships the new
// "enters-battlefield" `ReplacementEventKind` (issue #1148) — the
// FRAMEWORK is proven independently in
// `gre/__tests__/entersBattlefieldReplacement.test.ts` (synthetic
// redirector at every chokepoint); this file proves the SHIPPED CARD's own
// `appliesTo` filter (nontoken + creature + !wasCast) end to end.
import { describe, it, expect, beforeAll } from "vitest";
import { containmentPriest } from "..";
import { grizzlyBears } from "../../lea";
import { buildSpellContext, resolveTopOfStack } from "../../../../gre/state";
import { registerTokenDefinition } from "../../..";
import type { CardDefinition } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";

// Throwaway vehicle sorcery — pushed on the stack purely to obtain a
// resolving `StackItem` so `buildSpellContext` yields a `ctx` with
// `returnToBattlefield` (same pattern as
// `graveyardBoundReplacement.test.ts`'s p1Sorcery/p2Sorcery fixtures).
const VEHICLE_SORCERY_ID = "test-c14-reanimation-vehicle";
const vehicleSorcery: CardDefinition = {
    id: VEHICLE_SORCERY_ID,
    name: "Test C14 Reanimation Vehicle",
    rarity: "common",
    types: ["Sorcery"],
};

beforeAll(() => {
    registerTokenDefinition(vehicleSorcery);
});

describe("Containment Priest (CR 614, issue #1148)", () => {
    it("has Flash and no other keyword", () => {
        expect(containmentPriest.staticAbilities).toEqual(["flash"]);
    });

    it("exiles a nontoken creature reanimated (graveyard -> battlefield) while it's on the battlefield", () => {
        const priest = makeInstance(containmentPriest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bearGY",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest], graveyard: [bear] }),
                makePlayer("p2"),
            ],
        });
        const vehicle = pushSpell(state, VEHICLE_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, vehicle);
        const entered = ctx.returnToBattlefield("p1", "bearGY", "graveyard");
        // Exiled by the Priest instead of entering, so the primitive reports
        // false — callers must not treat the creature as a live permanent.
        expect(entered).toBe(false);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "bearGY")).toBe(false);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.some((c) => c.id === "bearGY")).toBe(true);
    });

    it("does NOT exile a normally CAST nontoken creature", () => {
        const priest = makeInstance(containmentPriest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, grizzlyBears.id, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(
            p1.battlefield.some(
                (c) => (c.card as { id?: string }).id === grizzlyBears.id
            )
        ).toBe(true);
        expect(p1.exile).toHaveLength(0);
    });

    it("does NOT exile a token creation (tokens are exempt regardless of cast origin)", () => {
        const priest = makeInstance(containmentPriest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest] }),
                makePlayer("p2"),
            ],
        });
        const vehicle = pushSpell(state, VEHICLE_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, vehicle);
        const ids = ctx.createToken(
            {
                name: "Test Cleric Token",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            },
            "p1"
        );
        expect(ids).toHaveLength(1);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === ids[0])).toBe(true);
        expect(p1.exile).toHaveLength(0);
    });

    it("wire format: the exile-redirected reanimated creature survives projectPublicState for both viewers", () => {
        const priest = makeInstance(containmentPriest.id, {
            id: "priest",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bearGY",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [priest], graveyard: [bear] }),
                makePlayer("p2"),
            ],
        });
        const vehicle = pushSpell(state, VEHICLE_SORCERY_ID, "p1");
        const ctx = buildSpellContext(state, vehicle);
        ctx.returnToBattlefield("p1", "bearGY", "graveyard");
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const p1Slim = projected.players.find((p) => p.id === "p1")!;
            expect(p1Slim.battlefield.some((c) => c.id === "bearGY")).toBe(
                false
            );
            expect(p1Slim.exile.some((c) => c.id === "bearGY")).toBe(true);
        }
    });
});
