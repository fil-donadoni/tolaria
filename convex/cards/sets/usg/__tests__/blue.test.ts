// USG — blue card behavior tests (ADR 0043 per-colour split).
//
// Annul reuses the already-exercised `counter` Op and the existing
// `spellTypeFilter` target filter, so the per-Op regime (§ DSL-first
// authoring) covers it catalogue-wide (validateEffectScript + the
// auto-generated smoke test). The issue nonetheless mandates a hand-written
// assertion that the artifact-OR-enchantment spell-type restriction is
// exhaustive over the spell-type union: legal against artifact / enchantment
// spells, illegal against creature / instant spells and abilities.

import { describe, it, expect } from "vitest";
import { annul } from "..";
import { blackLotus, crusade, grizzlyBears, lightningBolt } from "../../lea";
import { getLegalTargets } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";
import { makeState, makePlayer, pushSpell } from "../../../__tests__/setup";

describe("Annul ({U}: counter target artifact or enchantment spell, CR 701.5a / 114.1)", () => {
    it("legal targets are exactly the artifact and enchantment spells on the stack", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const artifactSpell = pushSpell(state, blackLotus.id, "p2"); // Artifact
        const enchantmentSpell = pushSpell(state, crusade.id, "p2"); // Enchantment
        pushSpell(state, grizzlyBears.id, "p2"); // Creature — not legal
        pushSpell(state, lightningBolt.id, "p2"); // Instant — not legal

        const legal = getLegalTargets(state, annul.targetRequirement!);
        expect(legal.map((t) => t.id).sort()).toEqual(
            [artifactSpell.id, enchantmentSpell.id].sort()
        );
    });

    it("a creature spell is not a legal target", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, grizzlyBears.id, "p2");
        expect(getLegalTargets(state, annul.targetRequirement!)).toHaveLength(
            0
        );
    });

    it("an instant spell is not a legal target", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p2");
        expect(getLegalTargets(state, annul.targetRequirement!)).toHaveLength(
            0
        );
    });

    it("resolving Annul counters the targeted artifact spell (CR 701.5a)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const artifactSpell = pushSpell(state, blackLotus.id, "p2"); // Artifact
        // Annul cast by p1 targeting the artifact spell, on top of the stack.
        pushSpell(state, annul.id, "p1", [
            { type: "spell", id: artifactSpell.id },
        ]);

        resolveTopOfStack(state);

        // The countered artifact spell left the stack for its owner's graveyard
        // (CR 701.5a) and never resolved onto the battlefield.
        expect(
            state.stack.find((i) => i.id === artifactSpell.id)
        ).toBeUndefined();
        const p2 = state.players.find((p) => p.id === "p2")!;
        expect(p2.graveyard.some((c) => c.card.id === blackLotus.id)).toBe(
            true
        );
        expect(p2.battlefield.some((c) => c.card.id === blackLotus.id)).toBe(
            false
        );
    });
});
