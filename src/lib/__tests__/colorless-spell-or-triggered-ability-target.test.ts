// Integration: "counter target triggered ability or colorless spell" (Consign
// to Memory) from the server pending-target build through to client target
// eligibility. Drives the SAME builder `announceCast` uses
// (`pendingTargetFiltersFromRequirement`) into `matchesSpellPendingTarget`,
// which delegates to the shared `checkSpellTargetFilters` registry.
// CR 105.2c (colorless), CR 113.3 (triggered vs activated), CR 701.6a.

import { describe, it, expect } from "vitest";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { consignToMemory } from "@convex/cards/sets/mh3/blue.cards";
import { counterspell, solRing } from "@convex/cards/sets/lea/index.cards";
import { matchesSpellPendingTarget } from "~/lib/card-utils";
import type { PendingTarget } from "~/types/game";

const requirement = consignToMemory().targetRequirement!;
const filters = pendingTargetFiltersFromRequirement(requirement, undefined);
const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

const pending = {
    playerId: "p1",
    cardInstanceId: "src",
    targetType: "spell",
    count: 1,
    selected: [],
    spellStackKind: filters.spellStackKind ?? "spell",
    spellColorless: filters.spellColorless,
} as unknown as PendingTarget;

const eligible = (item: Record<string, unknown>) =>
    matchesSpellPendingTarget(
        { id: "t", card: { id: "x" }, types: [], ...item } as never,
        pending,
        ctx
    );

describe("triggered ability or colorless spell target (CR 105.2c)", () => {
    it("the server build propagates both filter fields", () => {
        expect(filters.spellStackKind).toBe("spell-or-triggered-ability");
        expect(filters.spellColorless).toBe(true);
    });

    it("a triggered ability is eligible", () => {
        expect(eligible({ triggeredAbilityId: "etb" })).toBe(true);
    });

    it("an activated ability is not eligible", () => {
        expect(eligible({ abilityId: "ping" })).toBe(false);
    });

    it("a colorless spell is eligible", () => {
        expect(
            eligible({ card: { id: solRing().id }, types: ["Artifact"] })
        ).toBe(true);
    });

    it("a colored spell is not eligible", () => {
        expect(
            eligible({ card: { id: counterspell().id }, types: ["Instant"] })
        ).toBe(false);
    });
});
