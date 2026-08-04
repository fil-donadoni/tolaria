// #754 — restricted-mana label helper (CR 106.6, ADR 0022 / 0042). Restricted
// mana floats in a parallel pool and must be surfaced with WHY it is set apart
// (its spend restriction). These assert the human-readable label for each
// restriction shape: Ice Cauldron's instance-keyed cast restriction, the
// spell-class restrictions, and the generic fallback.
import { describe, it, expect } from "vitest";
import type { CardInstance, Player, RestrictedMana } from "~/types/game";
import { restrictedManaLabel } from "../restricted-mana";
import { canRefundManaTap, isManaCostCovered } from "../card-utils";
import {
    spendablePoolForAbility,
    spendablePoolForSpell,
} from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

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

// Issue #1713 — mana banked into a RESTRICTED bucket (CR 106.6) was invisible
// to two client-side reads that used the raw `manaPool` only: the "untap and
// refund" affordance (`canRefundManaTap`) and the payment banner's mana
// coverage check. The server payment path already treats it as spendable via
// `spendablePoolForAbility` / `spendablePoolForSpell` — this fix routes both
// client reads through the same helpers. Driven THROUGH `projectPublicState`
// (not a hand-built view, per `.claude/rules/gre-development.md` § Frontend
// wiring analysis) so a projection that dropped `restrictedMana` would fail
// here, not silently pass.
//
// Basalt Monolith (LEA) — "{T}: Add {C}{C}{C}." — a real catalogue artifact
// with a fixed `manaProduced` mana ability (CR 605.3a, `useStack: false`),
// so it exercises the exact `getEffectiveActivatedAbilities` path
// `canRefundManaTap` reads.
const BASALT_MONOLITH = "66a74c89-6f86-4ec8-af17-391cd5026054";

function projectedTappedMonolith(restrictedMana?: RestrictedMana[]) {
    const monolith = makeInstance(BASALT_MONOLITH, {
        id: "monolith1",
        controllerId: "p1",
        ownerId: "p1",
        isTapped: true,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [monolith],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                restrictedMana,
            }),
            makePlayer("p2"),
        ],
    });
    const projected = projectPublicState(state, 1, "p1");
    const me = projected.players[0] as unknown as Player;
    const card = me.battlefield.find(
        (c) => c?.id === "monolith1"
    ) as unknown as CardInstance;
    return { me, card };
}

describe("canRefundManaTap reads restricted mana (issue #1713, CR 106.6)", () => {
    it("survives projectPublicState — restrictedMana is forwarded on the wire", () => {
        const { me } = projectedTappedMonolith([
            { color: "C", amount: 3, restriction: "artifact-ability" },
        ]);
        expect(me.restrictedMana).toEqual([
            { color: "C", amount: 3, restriction: "artifact-ability" },
        ]);
    });

    it("offers the refund when the produced mana sits in an eligible artifact-ability bucket", () => {
        const { me, card } = projectedTappedMonolith([
            { color: "C", amount: 3, restriction: "artifact-ability" },
        ]);
        expect(canRefundManaTap(card, me)).toBe(true);
    });

    it("negative direction — a restricted bucket that does NOT permit this source's ability does not offer the refund (guards against over-offering)", () => {
        const { me, card } = projectedTappedMonolith([
            { color: "C", amount: 3, restriction: "cumulative-upkeep" },
        ]);
        expect(canRefundManaTap(card, me)).toBe(false);
    });

    it("no mana anywhere (fungible or restricted) → no refund offered", () => {
        const { me, card } = projectedTappedMonolith(undefined);
        expect(canRefundManaTap(card, me)).toBe(false);
    });
});

describe("payment banner mana coverage reads restricted mana (issue #1713, CR 106.6)", () => {
    it("spendablePoolForAbility (the banner's activation-branch check) counts an eligible artifact-ability bucket the raw manaPool alone misses", () => {
        const { me } = projectedTappedMonolith([
            { color: "C", amount: 3, restriction: "artifact-ability" },
        ]);
        const spendable = spendablePoolForAbility(me, ["Artifact"]);
        expect(isManaCostCovered(spendable, { C: 3 })).toBe(true);
        // Proves the pre-fix bug this replaces: the raw pool alone does NOT
        // cover the cost even though the restricted bucket does.
        expect(isManaCostCovered(me.manaPool, { C: 3 })).toBe(false);
    });

    it("spendablePoolForSpell (the banner's cast-branch check) leaves an ineligible restricted bucket unspendable (negative direction)", () => {
        const { me } = projectedTappedMonolith([
            { color: "C", amount: 3, restriction: "cumulative-upkeep" },
        ]);
        const spendable = spendablePoolForSpell(
            me,
            ["Artifact"],
            undefined,
            []
        );
        expect(isManaCostCovered(spendable, { C: 3 })).toBe(false);
    });
});
