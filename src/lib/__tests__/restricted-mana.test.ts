// #754 — restricted-mana label helper (CR 106.6, ADR 0022 / 0042). Restricted
// mana floats in a parallel pool and must be surfaced with WHY it is set apart
// (its spend restriction). These assert the human-readable label for each
// restriction shape: Ice Cauldron's instance-keyed cast restriction, the
// spell-class restrictions, and the generic fallback.
import { describe, it, expect } from "vitest";
import type { CardInstance, Player, RestrictedMana } from "~/types/game";
import { restrictedManaLabel } from "../restricted-mana";
import { canRefundManaTap } from "../card-utils";
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

// Issue #1713 — the "untap and refund" affordance (`canRefundManaTap`) read
// the fungible `manaPool` only, so a source whose mana ability carries a CR
// 106.6 spend restriction banked its output into the parallel `restrictedMana`
// pool and the refund option silently vanished.
//
// The axis under test is the SERVER refund's own question: is the bucket THIS
// ability deposited into (`manaRestriction` → `restrictedMana` unit, or the
// fungible pool when unrestricted) still holding the mana? That is NOT the
// spend-eligibility question `spendablePoolForAbility` answers — keyed on the
// source's own card types it excludes every restricted source from its own
// bucket (Soldevi Machinist is a Creature, Mishra's Workshop a Land), which is
// how the first attempt at this fix left both shipped cards broken. Every
// fixture below is therefore a REAL catalogue card/restriction pairing the
// engine can actually produce, and the negative cases are chosen so that a
// spend-eligibility implementation gets them WRONG.
//
// Driven THROUGH `projectPublicState` (not a hand-built view, per
// `.claude/rules/gre-development.md` § Frontend wiring analysis) so a
// projection that dropped `restrictedMana` fails here rather than silently
// passing.

/** Mishra's Workshop (ATQ) — Land, "{T}: Add {C}{C}{C}. Spend this mana only
 *  to cast artifact spells." → `manaRestriction: "artifact-spell"`. A spell
 *  restriction never permits an ABILITY, so a spend-eligibility check can
 *  never see this card's own mana. */
const MISHRAS_WORKSHOP = "135de5c7-6ac9-4b68-8f1a-97f120a4b125";
/** Soldevi Machinist (ICE) — Creature, "{T}: Add {C}{C}. Spend this mana only
 *  to activate abilities of artifacts." → `manaRestriction:
 *  "artifact-ability"`. The card issue #1708 shipped, and the one whose own
 *  types ("Creature") exclude it from its own `artifact-ability` bucket under
 *  a spend-eligibility check. */
const SOLDEVI_MACHINIST = "1f0999df-2f94-499e-b9af-fe377d515400";
/** Basalt Monolith (LEA) — Artifact, "{T}: Add {C}{C}{C}." with NO
 *  `manaRestriction`: its output always lands in the fungible `manaPool`. The
 *  unrestricted control, and the card that exposes the opposite error — a
 *  spend-eligibility check counts any `artifact-ability` bucket as this
 *  Artifact's mana and offers a free untap for mana it never produced. */
const BASALT_MONOLITH = "66a74c89-6f86-4ec8-af17-391cd5026054";

const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function projectedTappedSource(
    cardId: string,
    opts: {
        manaPool?: Record<string, number>;
        restrictedMana?: RestrictedMana[];
    } = {}
) {
    const source = makeInstance(cardId, {
        id: "src1",
        controllerId: "p1",
        ownerId: "p1",
        isTapped: true,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [source],
                manaPool: { ...EMPTY_POOL, ...(opts.manaPool ?? {}) },
                restrictedMana: opts.restrictedMana,
            }),
            makePlayer("p2"),
        ],
    });
    const projected = projectPublicState(state, 1, "p1");
    const me = projected.players[0] as unknown as Player;
    const card = me.battlefield.find(
        (c) => c?.id === "src1"
    ) as unknown as CardInstance;
    return { me, card };
}

describe("canRefundManaTap keys on the producing ability's own bucket (issue #1713, CR 106.4/106.6)", () => {
    it("survives projectPublicState — restrictedMana is forwarded on the wire", () => {
        const { me } = projectedTappedSource(SOLDEVI_MACHINIST, {
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        expect(me.restrictedMana).toEqual([
            { color: "C", amount: 2, restriction: "artifact-ability" },
        ]);
    });

    it("Soldevi Machinist (Creature / artifact-ability) — its own bucket still holds the {C}{C} it made → refund offered", () => {
        // Reachable: tap the Machinist for mana and do nothing with it.
        const { me, card } = projectedTappedSource(SOLDEVI_MACHINIST, {
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        expect(canRefundManaTap(card, me)).toBe(true);
    });

    it("Mishra's Workshop (Land / artifact-spell) — its own bucket still holds the {C}{C}{C} it made → refund offered", () => {
        // Reachable: tap the Workshop for mana and do nothing with it.
        const { me, card } = projectedTappedSource(MISHRAS_WORKSHOP, {
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        expect(canRefundManaTap(card, me)).toBe(true);
    });

    it("Mishra's Workshop — its bucket is empty but the FUNGIBLE pool happens to hold {C}{C}{C} → NO refund (that mana is not its to give back)", () => {
        // Reachable: the Workshop is tapped BY AN EFFECT, not tapped for mana
        // — an opponent's Icy Manipulator ("{1}, {T}: Tap target artifact,
        // creature, or land", `lea/colorless.ts`) — so it produced nothing and
        // `manaCommitted` stays unset. Meanwhile its controller taps Basalt
        // Monolith for three fungible {C}.
        //
        // NOT reachable by letting the step end: `emptyManaPools`
        // (`gre/phases.ts`) sets `manaCommitted = true` on EVERY tapped
        // battlefield card and clears `restrictedMana` outright, so down that
        // path `canRefundManaTap` returns false at its first guard and never
        // reaches the pool check this test is about.
        //
        // A spend-eligibility check gets this WRONG: `spendablePoolForAbility`
        // merges the fungible pool in and reports coverage, offering a free
        // untap of a source that never produced that mana — the exact hazard
        // this predicate exists to prevent.
        const { me, card } = projectedTappedSource(MISHRAS_WORKSHOP, {
            manaPool: { C: 3 },
        });
        expect(canRefundManaTap(card, me)).toBe(false);
    });

    it("Basalt Monolith (unrestricted) — the fungible pool holds its {C}{C}{C} → refund offered", () => {
        const { me, card } = projectedTappedSource(BASALT_MONOLITH, {
            manaPool: { C: 3 },
        });
        expect(canRefundManaTap(card, me)).toBe(true);
    });

    it("Basalt Monolith (unrestricted) — fungible pool empty, only somebody else's artifact-ability bucket floating → NO refund", () => {
        // Reachable by the same route as the Workshop case above: the Monolith
        // is tapped BY AN EFFECT (an opponent's Icy Manipulator targets an
        // artifact just as happily as a land), so it produced nothing and
        // `manaCommitted` stays unset, while its controller taps two Soldevi
        // Machinists for four restricted {C}. Again NOT reachable via a step
        // boundary — `emptyManaPools` would both commit the Monolith and wipe
        // the bucket this test needs floating.
        //
        // A spend-eligibility check gets this WRONG too, in the opposite
        // direction: the Monolith IS an Artifact, so `artifact-ability` mana
        // reads as eligible and the refund is offered for mana the Monolith
        // never produced.
        const { me, card } = projectedTappedSource(BASALT_MONOLITH, {
            restrictedMana: [
                { color: "C", amount: 4, restriction: "artifact-ability" },
            ],
        });
        expect(canRefundManaTap(card, me)).toBe(false);
    });

    it("no mana anywhere (fungible or restricted) → no refund offered", () => {
        const { me, card } = projectedTappedSource(BASALT_MONOLITH);
        expect(canRefundManaTap(card, me)).toBe(false);
    });
});
