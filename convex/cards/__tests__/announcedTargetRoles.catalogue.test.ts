// Catalogue guard, issue #4193 — a target group whose announced slots receive
// DIFFERENT halves of the effect (CR 601.2c) MUST be able to say which half
// each slot gets.
//
// The mechanism has two independent halves, and this test is what keeps them
// from drifting apart. `announcedTargetSlotsDiffer` is STRUCTURAL — it knows
// only that the Ops reading slot 0 and slot 1 are not the same Op — while
// `announcedTargetRoles` needs a PHRASE for each of those Ops, out of a closed
// table. A card whose slots differ through an Op that table does not carry
// gets no per-Target text at all, which is precisely the pick-blind bug this
// issue fixed: silent, and identical to the pre-fix prompt. So it reds HERE,
// at definition time, naming the card and the missing site, instead of
// shipping.
//
// Scope note: the sweep asks each requirement's PRIMARY group, the window
// `[0, count)`, because that is the window the announcement wires roles for
// (`announcedTargetRoleFields`, `convex/game.ts`) — an `additionalTarget-
// Requirements` entry's offset is not decided until the groups before it have
// their picks in. That is also the whole reach of the bug: the count-widening
// kicked announcement (CR 702.33g) is always a card's sole group.
import { describe, it, expect } from "vitest";
import { getAllCatalogueCards } from "../index";
import type { EffectOp, TargetRequirement } from "../types";
import {
    announcedTargetRoles,
    announcedTargetSlotsDiffer,
} from "../../gre/targetRoles";

interface Site {
    where: string;
    requirement: TargetRequirement | undefined;
    effects: EffectOp[] | undefined;
}

function sitesOf(
    card: ReturnType<typeof getAllCatalogueCards>[number]
): Site[] {
    const sites: Site[] = [
        {
            where: "targetRequirement",
            requirement: card.targetRequirement,
            effects: card.effects,
        },
        {
            where: "kickedTargetRequirement",
            requirement: card.kickedTargetRequirement,
            effects: card.effects,
        },
    ];
    for (const mode of card.modes ?? []) {
        sites.push({
            where: `mode ${mode.id}`,
            requirement: mode.targetRequirement,
            effects: mode.effects ?? card.effects,
        });
    }
    for (const ability of card.activatedAbilities ?? []) {
        sites.push({
            where: `ability ${ability.id}`,
            requirement: ability.targetRequirement,
            effects: ability.effects,
        });
    }
    for (const trigger of card.triggeredAbilities ?? []) {
        sites.push({
            where: `trigger ${trigger.id}`,
            requirement: trigger.targetRequirement,
            effects: trigger.effects,
        });
    }
    return sites;
}

describe("announced target roles — catalogue guard (CR 601.2c, issue #4193)", () => {
    it("every group whose slots receive different halves can name them", () => {
        const offenders: string[] = [];
        for (const card of getAllCatalogueCards()) {
            for (const { where, requirement, effects } of sitesOf(card)) {
                const count = requirement?.count;
                if (typeof count !== "number" || count < 2) continue;
                if (!announcedTargetSlotsDiffer(effects, 0, count)) continue;
                if (announcedTargetRoles(effects, 0, count) === undefined) {
                    offenders.push(
                        `${card.name} :: ${where} — slots differ but no phrase ` +
                            `(add the Op's row to ROLE_PHRASE in gre/targetRoles.ts)`
                    );
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("Jilt, the card the mechanism was built for, names both halves", () => {
        // A sweep that is vacuous passes forever; this pins the one card the
        // catalogue actually has in the asymmetric shape (CR 702.33g).
        const jilt = getAllCatalogueCards().find((c) => c.name === "Jilt");
        expect(jilt).toBeDefined();
        expect(jilt!.kickedTargetRequirement?.count).toBe(2);
        expect(announcedTargetRoles(jilt!.effects, 0, 2)).toEqual([
            "returned to its owner's hand",
            "dealt 2 damage",
        ]);
    });

    it("the symmetric kicked family stays unlabelled", () => {
        // Magma Burst, Falling Timber, Rushing River, Dwarven Landslide — the
        // cards this encoding shipped on. Their prompt must be unchanged.
        const symmetric = [
            "Magma Burst",
            "Falling Timber",
            "Rushing River",
            "Dwarven Landslide",
        ];
        for (const name of symmetric) {
            const card = getAllCatalogueCards().find((c) => c.name === name);
            expect(card, name).toBeDefined();
            const count = card!.kickedTargetRequirement?.count;
            expect(count, name).toBe(2);
            expect(
                announcedTargetRoles(card!.effects, 0, count as number),
                name
            ).toBeUndefined();
        }
    });
});
