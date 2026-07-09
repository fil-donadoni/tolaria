import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import { mineCollapse } from "../red";

// Mine Collapse — {3}{R} Instant. "If it's your turn, you may sacrifice a
// Mountain rather than pay this spell's mana cost. Mine Collapse deals 5 damage
// to target creature or planeswalker." (CR 118.9 pitch cost — sacrifice a
// Mountain, gated on your-turn; CR 120.1 damage.) The sacrifice leg reuses the
// existing permanent machinery; the dealDamage effect (reused Op) is covered by
// the catalogue smoke sweep. Here we pin the definition + resolve one damage.
describe("Mine Collapse (pitch: sacrifice a Mountain, your turn)", () => {
    const treefolk = getCardByName("Ironroot Treefolk"); // 3/5 — survives 5? no, dies

    it("declares the conditional sacrifice alternative cost", () => {
        expect(mineCollapse.alternativeCosts).toEqual([
            {
                id: "pitch-sacrifice-mountain",
                description: "Sacrifice a Mountain",
                action: "sacrifice",
                count: 1,
                filter: { subtypes: "Mountain" },
                condition: { kind: "your-turn" },
            },
        ]);
        expect(mineCollapse.targetRequirement).toEqual({
            type: ["Creature", "Planeswalker"],
            count: 1,
        });
    });

    it("deals 5 damage to the target creature (lethal to a 3/5)", () => {
        const victim = makeInstance(treefolk.id, {
            id: "v",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, mineCollapse.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        // 5 damage ≥ toughness 5 → destroyed by SBA.
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});
