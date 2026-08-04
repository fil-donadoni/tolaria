// Integration: Subtlety "choose up to one target creature spell or planeswalker
// spell" from the server pending-target build (the #1193 trigger-target path)
// through to client target eligibility. No convex-test harness (ADR 0001), so
// this drives the SAME exported builder `raiseTriggerTargetSelection` feeds a
// trigger PendingTarget — `pendingTargetFiltersFromRequirement` — into the
// client eligibility predicate (`wantsSpellTarget`, `matchesSpellPendingTarget`),
// reproducing the GRE→game.ts→UI path (#1205).

import { describe, it, expect } from "vitest";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { subtlety } from "@convex/cards/sets/mh2/blue";
import { matchesSpellPendingTarget, wantsSpellTarget } from "~/lib/card-utils";
import type { PendingTarget } from "~/types/game";

/** Minimal `PendingTarget` carrying only the SPELL filter dimensions under
 *  test (issue #1734) — `matchesSpellPendingTarget`'s single-filter twin of
 *  the deleted `matchesStackObjectFilter` / `matchesSpellTypeFilter` mirrors. */
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

describe("Subtlety target integration (trigger spell-target → client eligibility, CR 113)", () => {
    const req = subtlety.triggeredAbilities!.find(
        (a) => a.id === "subtlety-etb"
    )!.targetRequirement!;
    const filters = pendingTargetFiltersFromRequirement(req, undefined);
    const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

    it("the trigger pending-target build propagates spell-kind + creature/PW spellTypeFilter", () => {
        expect(filters.spellStackKind).toBe("spell");
        expect(filters.spellTypeFilter).toEqual(["Creature", "Planeswalker"]);
        expect(wantsSpellTarget(req.type)).toBe(true);
    });

    it("a creature spell on the stack is client-clickable", () => {
        const creatureSpell = {
            id: "creature-spell",
            card: { id: "x" },
            types: ["Creature"],
        };
        expect(
            matchesSpellPendingTarget(
                creatureSpell,
                pt({
                    spellStackKind: filters.spellStackKind ?? "spell",
                    stackSourceTypeFilter: filters.stackSourceTypeFilter,
                    spellTargetsInstanceIds: filters.spellTargetsInstanceIds,
                }),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                creatureSpell,
                pt({ spellTypeFilter: filters.spellTypeFilter }),
                ctx
            )
        ).toBe(true);
    });

    it("an instant spell is NOT clickable (wrong spell type)", () => {
        const instantSpell = {
            id: "instant-spell",
            card: { id: "x" },
            types: ["Instant"],
        };
        // Passes the spell-vs-ability gate but fails the creature/PW type gate.
        expect(
            matchesSpellPendingTarget(
                instantSpell,
                pt({
                    spellStackKind: filters.spellStackKind ?? "spell",
                    stackSourceTypeFilter: filters.stackSourceTypeFilter,
                    spellTargetsInstanceIds: filters.spellTargetsInstanceIds,
                }),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                instantSpell,
                pt({ spellTypeFilter: filters.spellTypeFilter }),
                ctx
            )
        ).toBe(false);
    });

    it("an ability on the stack is NOT clickable (spell-kind rejects abilities)", () => {
        const trigger = {
            id: "trigger",
            card: { id: "x" },
            triggeredAbilityId: "x",
            types: [],
        };
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
        ).toBe(false);
    });
});
