// Integration: Stifle "counter target activated or triggered ability" from the
// server pending-target build through to client target eligibility (the bug
// where the on-stack ability was never clickable). The project has no
// convex-test harness (ADR 0001), so this drives the SAME exported builder the
// `announceCast` mutation uses — `pendingTargetFiltersFromRequirement` — and
// feeds its output into the client eligibility predicate `matchesSpellPendingTarget`
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
import { matchesSpellPendingTarget, wantsSpellTarget } from "~/lib/card-utils";
import type { PendingTarget } from "~/types/game";

/** Minimal `PendingTarget` carrying only the SPELL filter dimensions under
 *  test (issue #1734) — `matchesSpellPendingTarget`'s single-filter twin of
 *  the deleted `matchesStackObjectFilter` mirror. */
function pt(filters: Record<string, unknown>): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "src",
        targetType: "spell",
        count: 1,
        selected: [],
        spellStackKind: "any",
        ...filters,
    } as unknown as PendingTarget;
}

describe("Stifle target integration (server build → client eligibility, CR 701.6a)", () => {
    const filters = pendingTargetFiltersFromRequirement(
        stifle.targetRequirement!,
        undefined
    );
    const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

    it("the server pending-target build propagates spellStackKind: 'ability'", () => {
        // This is the field `announceCast` used to drop.
        expect(filters.spellStackKind).toBe("ability");
    });

    it("a triggered ability on the stack is client-clickable for Stifle", () => {
        const trigger = {
            id: "trigger",
            card: { id: "x" },
            triggeredAbilityId: "dread-etb",
            types: [],
        };
        expect(wantsSpellTarget(stifle.targetRequirement!.type)).toBe(true);
        expect(
            matchesSpellPendingTarget(
                trigger,
                pt({
                    spellStackKind: filters.spellStackKind ?? "spell",
                    stackSourceTypeFilter: filters.stackSourceTypeFilter,
                    spellTargetsInstanceIds: filters.spellTargetsInstanceIds,
                }),
                ctx
            )
        ).toBe(true);
    });

    it("an activated ability on the stack is client-clickable for Stifle", () => {
        const activated = {
            id: "activated",
            card: { id: "x" },
            abilityId: "ping",
            types: [],
        };
        expect(
            matchesSpellPendingTarget(
                activated,
                pt({
                    spellStackKind: filters.spellStackKind ?? "spell",
                    stackSourceTypeFilter: filters.stackSourceTypeFilter,
                    spellTargetsInstanceIds: filters.spellTargetsInstanceIds,
                }),
                ctx
            )
        ).toBe(true);
    });

    it("a spell on the stack is NOT clickable for Stifle (ability-kind rejects spells)", () => {
        const spell = { id: "spell", card: { id: "x" }, types: ["Instant"] };
        expect(
            matchesSpellPendingTarget(
                spell,
                pt({
                    spellStackKind: filters.spellStackKind ?? "spell",
                    stackSourceTypeFilter: filters.stackSourceTypeFilter,
                    spellTargetsInstanceIds: filters.spellTargetsInstanceIds,
                }),
                ctx
            )
        ).toBe(false);
    });
});
