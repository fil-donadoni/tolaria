// Per-card behavior tests for black cards in `convex/cards/sets/exo/black.ts`
// (Exodus, split by colour per ADR 0043). Fixtures from
// `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import { cursedFlesh } from "../black";
import { grizzlyBears } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Cursed Flesh — "Enchant creature. Enchanted creature gets -1/-1 and has
// fear." (CR 613.4c layer 7c pt-buff + CR 702.36 keyword-grant, both via
// `staticEffects[]` — no catalogue-wide sweep covers the layer system, so
// this is the only proof the Aura actually debuffs/grants anything.)
describe("Cursed Flesh (Aura -1/-1 + fear, staticEffects[] layer system, CR 613.4c / 702.36)", () => {
    it("gives the enchanted creature -1/-1 and fear while attached, and nothing when unattached", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Unattached: unaffected.
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);
        expect(bear.staticAbilities).not.toContain("fear");

        pushSpell(state, cursedFlesh.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, bearAfter)).toBe(1); // 2 - 1
        expect(getEffectiveToughness(state, bearAfter)).toBe(1); // 2 - 1
        expect(bearAfter.staticAbilities).toContain("fear");
    });

    it("wire format: the -1/-1 buff and the fear grant survive projectPublicState", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, cursedFlesh.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p2");
        const slimBear = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slimBear)).toBe(1);
        expect(getEffectiveToughness(projected, slimBear)).toBe(1);
        expect(slimBear.staticAbilities).toContain("fear");
    });
});
