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
//
// It DOES walk the cast SUBJECTS (CR 715.3a/b, ADR 0120 §4): an Adventure or
// split half announces its own requirement out of its own script, and a sweep
// that only read the printed card would be blind to exactly the pairing the
// engine had wrong before this issue's review round.
import { describe, it, expect } from "vitest";
import { getAllCatalogueCards } from "../index";
import type { CardDefinition, EffectOp, TargetRequirement } from "../types";
import { adventureCastAltCostId } from "../../gre/adventure";
import { castSubjectDefinition } from "../../gre/castMode";
import { splitCastAltCostId } from "../../gre/splitCast";
import {
    announcedTargetRoles,
    announcedTargetSlotsDiffer,
} from "../../gre/targetRoles";

interface Site {
    where: string;
    requirement: TargetRequirement | undefined;
    effects: EffectOp[] | undefined;
}

function sitesOf(card: CardDefinition): Site[] {
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
    // CR 715.3a (ADR 0120 §4) — a cast whose SUBJECT is a different
    // definition (an Adventure half, a split half) announces THAT
    // definition's requirement out of THAT definition's script. Those ids are
    // synthesized per mechanic rather than declared in `alternativeCosts`,
    // which is why they are named here; every ordinary alt cost keeps the
    // printed card as its subject and is dropped by the `!== card` filter.
    const subjectIds = [
        adventureCastAltCostId(card),
        splitCastAltCostId(card, "left"),
        splitCastAltCostId(card, "right"),
    ];
    for (const id of subjectIds) {
        const subject = castSubjectDefinition(card, id);
        if (!subject || subject === card) continue;
        sites.push({
            where: `cast subject ${id}`,
            requirement: subject.targetRequirement,
            effects: subject.effects,
        });
    }
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
                        `${card.name} :: ${where} — the slots differ but the ` +
                            `announcement cannot name them. One of: an Op or a ` +
                            `moveZone destination missing from ROLE_PHRASE; two ` +
                            `Ops that map to the SAME phrase (make them ` +
                            `distinguishable or make the slots identical); a slot ` +
                            `read in two branches of one \`if\`. All in ` +
                            `gre/targetRoles.ts. A site that is not a CAST also ` +
                            `needs wiring — roles are attached in announceCast ` +
                            `only (see announcedTargetRoleFields, convex/game.ts).`
                    );
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("actually reaches the cast subjects (the sweep is not printed-card-only)", () => {
        // No catalogue half is asymmetric today, so the subject branch of the
        // sweep above is silent — and a silent branch that stopped running
        // would look exactly the same. Pin that it runs: an Adventure or split
        // half IS a distinct definition and the sweep visits it. Without this
        // the guard would keep the blind spot that let the announcement pair
        // one half's requirement with the printed card's script.
        const subjectSites = getAllCatalogueCards().flatMap((card) =>
            sitesOf(card).filter((s) => s.where.startsWith("cast subject "))
        );
        expect(subjectSites.length).toBeGreaterThan(0);
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
