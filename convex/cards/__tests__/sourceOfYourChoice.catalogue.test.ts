import { describe, expect, it } from "vitest";
import { getAllCards } from "../index";
import type { CardDefinition } from "../types";

/**
 * Catalogue-wide guard for "a source of your choice" (CR 609.7a): the source
 * is chosen on resolution and is NOT a target (CR 115.1), so no clause whose
 * text names such a source and no `target` may declare a `targetRequirement`.
 * A targeted source would be barred by shroud/hexproof/protection, fire
 * "becomes the target" triggers, lock at announcement and fizzle when it
 * leaves — and an `"any"`-typed one would offer players as a damage source.
 *
 * A clause that ALSO prints a real target (Jade Monolith's "target creature")
 * keeps that target; only a clause with no printed "target" is checked.
 */
const SOURCE_OF_YOUR_CHOICE = /source of your choice/i;
const PRINTS_A_TARGET = /\btargets?\b/i;

type Clause = {
    where: string;
    oracleText?: string;
    targetRequirement?: unknown;
};

function clausesOf(card: CardDefinition): Clause[] {
    const clauses: Clause[] = [
        {
            where: `${card.name} (card)`,
            oracleText: card.oracleText,
            targetRequirement: card.targetRequirement,
        },
    ];
    for (const m of card.modes ?? []) {
        clauses.push({
            where: `${card.name} mode ${m.id}`,
            oracleText: m.oracleText,
            targetRequirement: m.targetRequirement,
        });
    }
    for (const a of card.activatedAbilities ?? []) {
        clauses.push({
            where: `${card.name} ability ${a.id}`,
            oracleText: a.oracleText,
            targetRequirement: a.targetRequirement,
        });
    }
    return clauses;
}

describe("a source of your choice is never a target (CR 609.7a)", () => {
    it("no clause naming one declares a targetRequirement", () => {
        const offenders: string[] = [];
        let checked = 0;
        for (const card of getAllCards()) {
            // A modal card's top-level text spans every mode; its modes carry
            // the per-clause text, so the card-level read applies only to a
            // card without modes.
            const clauses = clausesOf(card).filter(
                (c, i) => !(i === 0 && card.modes !== undefined)
            );
            for (const c of clauses) {
                if (!c.oracleText) continue;
                if (!SOURCE_OF_YOUR_CHOICE.test(c.oracleText)) continue;
                if (PRINTS_A_TARGET.test(c.oracleText)) continue;
                checked++;
                if (c.targetRequirement !== undefined) offenders.push(c.where);
            }
        }
        expect(checked).toBeGreaterThan(10);
        expect(offenders).toEqual([]);
    });
});
