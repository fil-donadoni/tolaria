// Integration: Subtlety "choose up to one target creature spell or planeswalker
// spell" from the server pending-target build (the #1193 trigger-target path)
// through to client target eligibility. No convex-test harness (ADR 0001), so
// this drives the SAME exported builder `raiseTriggerTargetSelection` feeds a
// trigger PendingTarget — `pendingTargetFiltersFromRequirement` — into the
// client eligibility helpers (`wantsSpellTarget`, `matchesStackObjectFilter`,
// `matchesSpellTypeFilter`), reproducing the GRE→game.ts→UI path (#1205).

import { describe, it, expect } from "vitest";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { subtlety } from "@convex/cards/sets/mh2/blue";
import {
    matchesSpellTypeFilter,
    matchesStackObjectFilter,
    wantsSpellTarget,
} from "~/lib/card-utils";

describe("Subtlety target integration (trigger spell-target → client eligibility, CR 113)", () => {
    const req = subtlety.triggeredAbilities!.find(
        (a) => a.id === "subtlety-etb"
    )!.targetRequirement!;
    const filters = pendingTargetFiltersFromRequirement(req, undefined);

    it("the trigger pending-target build propagates spell-kind + creature/PW spellTypeFilter", () => {
        expect(filters.spellStackKind).toBe("spell");
        expect(filters.spellTypeFilter).toEqual(["Creature", "Planeswalker"]);
        expect(wantsSpellTarget(req.type)).toBe(true);
    });

    it("a creature spell on the stack is client-clickable", () => {
        const creatureSpell = { types: ["Creature"] };
        expect(
            matchesStackObjectFilter(
                creatureSpell,
                filters.spellStackKind,
                filters.stackSourceTypeFilter,
                filters.spellTargetsInstanceIds
            )
        ).toBe(true);
        expect(
            matchesSpellTypeFilter(creatureSpell, filters.spellTypeFilter)
        ).toBe(true);
    });

    it("an instant spell is NOT clickable (wrong spell type)", () => {
        const instantSpell = { types: ["Instant"] };
        // Passes the spell-vs-ability gate but fails the creature/PW type gate.
        expect(
            matchesStackObjectFilter(
                instantSpell,
                filters.spellStackKind,
                filters.stackSourceTypeFilter,
                filters.spellTargetsInstanceIds
            )
        ).toBe(true);
        expect(
            matchesSpellTypeFilter(instantSpell, filters.spellTypeFilter)
        ).toBe(false);
    });

    it("an ability on the stack is NOT clickable (spell-kind rejects abilities)", () => {
        const trigger = { triggeredAbilityId: "x", types: [] };
        expect(
            matchesStackObjectFilter(
                trigger,
                filters.spellStackKind,
                filters.stackSourceTypeFilter,
                filters.spellTargetsInstanceIds
            )
        ).toBe(false);
    });
});
