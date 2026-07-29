// #754 — restricted-mana label helper (CR 106.6, ADR 0022 / 0042). Restricted
// mana floats in a parallel pool and must be surfaced with WHY it is set apart
// (its spend restriction). These assert the human-readable label for each
// restriction shape: Ice Cauldron's instance-keyed cast restriction, the
// spell-class restrictions, and the generic fallback.
import { describe, it, expect } from "vitest";
import type { RestrictedMana } from "~/types/game";
import { restrictedManaLabel } from "../restricted-mana";

describe("restrictedManaLabel (#754, CR 106.6)", () => {
    it("labels Ice Cauldron instance-keyed mana with the exiled card's name", () => {
        const unit: RestrictedMana = {
            color: "U",
            amount: 2,
            castableCardId: "noted-spell",
        };
        const label = restrictedManaLabel(unit, (id) =>
            id === "noted-spell" ? "Brainstorm" : undefined
        );
        expect(label).toBe("Only: Brainstorm");
    });

    it("falls back to a generic exiled-card label when the name can't resolve", () => {
        const unit: RestrictedMana = {
            color: "U",
            amount: 1,
            castableCardId: "gone",
        };
        expect(restrictedManaLabel(unit, () => undefined)).toBe(
            "Only: exiled card"
        );
    });

    it("labels the creature-spell restriction", () => {
        const unit: RestrictedMana = {
            color: "G",
            amount: 1,
            restriction: "creature-spell",
        };
        expect(restrictedManaLabel(unit)).toBe("Creature spells only");
    });

    it("labels the artifact-spell restriction", () => {
        const unit: RestrictedMana = {
            color: "C",
            amount: 1,
            restriction: "artifact-spell",
        };
        expect(restrictedManaLabel(unit)).toBe("Artifact spells only");
    });

    it("labels the cumulative-upkeep restriction", () => {
        const unit: RestrictedMana = {
            color: "W",
            amount: 1,
            restriction: "cumulative-upkeep",
        };
        expect(restrictedManaLabel(unit)).toBe("Cumulative upkeep only");
    });

    it("labels the artifact-ability restriction (Soldevi Machinist, #728)", () => {
        const unit: RestrictedMana = {
            color: "C",
            amount: 2,
            restriction: "artifact-ability",
        };
        expect(restrictedManaLabel(unit)).toBe("Artifact abilities only");
    });

    it("uses a generic label when no restriction is set", () => {
        const unit: RestrictedMana = { color: "R", amount: 1 };
        expect(restrictedManaLabel(unit)).toBe("Restricted");
    });

    it("labels the legendary-spell restriction (Delighted Halfling, #1559)", () => {
        const unit: RestrictedMana = {
            color: "W",
            amount: 1,
            restriction: "legendary-spell",
        };
        expect(restrictedManaLabel(unit)).toBe("Legendary spells only");
    });

    it("appends the can't-be-countered rider to any base label (#1559)", () => {
        const withRestriction: RestrictedMana = {
            color: "W",
            amount: 1,
            restriction: "legendary-spell",
            cantBeCounteredRider: true,
        };
        expect(restrictedManaLabel(withRestriction)).toBe(
            "Legendary spells only — can't be countered"
        );

        // The rider is orthogonal to `restriction` — it also combines with
        // the generic fallback when no restriction is set at all.
        const noRestriction: RestrictedMana = {
            color: "W",
            amount: 1,
            cantBeCounteredRider: true,
        };
        expect(restrictedManaLabel(noRestriction)).toBe(
            "Restricted — can't be countered"
        );
    });
});
