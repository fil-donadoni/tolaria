/**
 * Guard for vitest.setup.node.ts: the node projects run `isolate: false`
 * (shared module registry per worker), so the shared catalogue MUST be
 * deep-frozen or an in-place mutation in one test file silently poisons
 * whichever file the scheduler runs next (order-dependent heisen-red,
 * observed 2026-08-27 on Figure of Fable's `grantAbility` op).
 *
 * This test proves the setup actually ran and actually froze the deep
 * structure — a setup file dropped from the config would otherwise fail
 * silently, reopening the hole with every test still green.
 */
import { describe, expect, it } from "vitest";
import { getAllCards } from "../../convex/cards/catalogue";

describe("shared catalogue is deep-frozen in node projects (vitest.setup.node.ts)", () => {
    it("every definition object is frozen", () => {
        const cards = getAllCards();
        expect(cards.length).toBeGreaterThan(1000);
        for (const def of cards) {
            expect(Object.isFrozen(def), `unfrozen definition: ${def.id}`).toBe(
                true
            );
        }
    });

    it("nested structures are frozen too, and a write THROWS in place", () => {
        const withAbility = getAllCards().find(
            (d) => (d.activatedAbilities?.length ?? 0) > 0
        )!;
        const ability = withAbility.activatedAbilities![0];
        expect(Object.isFrozen(ability)).toBe(true);
        // Strict mode (ESM) turns a write to a frozen object into a
        // TypeError AT THE GUILTY LINE — the whole point of the setup.
        expect(() => {
            (ability as { id: string }).id = "mutated";
        }).toThrow(TypeError);
    });
});
