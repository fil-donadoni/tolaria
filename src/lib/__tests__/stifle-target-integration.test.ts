// Integration: Stifle "counter target activated or triggered ability" from the
// server pending-target build through to client target eligibility (the bug
// where the on-stack ability was never clickable). The project has no
// convex-test harness (ADR 0001), so this drives the SAME exported builder the
// `announceCast` mutation uses — `pendingTargetFiltersFromRequirement` — and
// feeds its output into the client eligibility helper `matchesStackObjectFilter`
// (game-stack.tsx), reproducing the full GRE→game.ts→UI path in one test.
//
// Root cause guarded: `announceCast`'s primary pending-target build once omitted
// `spellStackKind`, so the client saw `spellStackKind: undefined` and treated a
// "target ability" (CR 113 / 701.5a) as "target spell" — the trigger tile never
// lit up. Both builders now derive filters from the shared helper, so the field
// can no longer be dropped.

import { describe, it, expect } from "vitest";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { stifle } from "@convex/cards/sets/scg/blue";
import { matchesStackObjectFilter, wantsSpellTarget } from "~/lib/card-utils";

describe("Stifle target integration (server build → client eligibility, CR 701.5a)", () => {
    const filters = pendingTargetFiltersFromRequirement(
        stifle.targetRequirement!,
        undefined
    );

    it("the server pending-target build propagates spellStackKind: 'ability'", () => {
        // This is the field `announceCast` used to drop.
        expect(filters.spellStackKind).toBe("ability");
    });

    it("a triggered ability on the stack is client-clickable for Stifle", () => {
        const trigger = { triggeredAbilityId: "dread-etb", types: [] };
        expect(wantsSpellTarget(stifle.targetRequirement!.type)).toBe(true);
        expect(
            matchesStackObjectFilter(
                trigger,
                filters.spellStackKind,
                filters.stackSourceTypeFilter,
                filters.spellTargetsInstanceIds
            )
        ).toBe(true);
    });

    it("an activated ability on the stack is client-clickable for Stifle", () => {
        const activated = { abilityId: "ping", types: [] };
        expect(
            matchesStackObjectFilter(
                activated,
                filters.spellStackKind,
                filters.stackSourceTypeFilter,
                filters.spellTargetsInstanceIds
            )
        ).toBe(true);
    });

    it("a spell on the stack is NOT clickable for Stifle (ability-kind rejects spells)", () => {
        const spell = { types: ["Instant"] };
        expect(
            matchesStackObjectFilter(
                spell,
                filters.spellStackKind,
                filters.stackSourceTypeFilter,
                filters.spellTargetsInstanceIds
            )
        ).toBe(false);
    });
});
