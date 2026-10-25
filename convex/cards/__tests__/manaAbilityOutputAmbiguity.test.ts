// Catalogue-wide guard for `resolveManaAbilityByOutput` (convex/game.ts).
//
// A refund resolves WHICH mana ability produced a `chosenMana` snapshot by
// matching its output shape against the card's non-stack mana abilities. That
// is only sound if two abilities on one card never share an output shape while
// differing in what the refund reverses: `manaRestriction` or a CR 106.6 rider.
// Identical-and-agreeing pairs (Quirion Elves) stay legal — either resolves to
// the same reversal.
import { describe, it, expect } from "vitest";
import { getAllCards } from "..";
import type { ActivatedAbility } from "../types";
import { MANA_COLORS } from "../../gre/manaColors";

type Shape = string;

const shapeKey = (m: Record<string, number | undefined>): Shape =>
    MANA_COLORS.map((c) => `${c}${m[c] ?? 0}`).join("");

// Mirrors the matcher in `resolveManaAbilityByOutput`: manaChoices when
// declared, else the fixed manaProduced.
function outputShapes(a: ActivatedAbility): Shape[] {
    if (a.manaChoices) return a.manaChoices.map(shapeKey);
    return a.manaProduced ? [shapeKey(a.manaProduced)] : [];
}

const reversalKey = (a: ActivatedAbility): string =>
    JSON.stringify([
        a.manaRestriction ?? null,
        a.manaCantBeCounteredRider ?? false,
        a.manaHasteRider ?? false,
    ]);

describe("Mana ability output matching — no ambiguous pair (CR 106.6)", () => {
    it("no card has two mana abilities with one output shape but different restriction/rider", () => {
        const offenders: string[] = [];

        for (const card of getAllCards()) {
            const abilities = (card.activatedAbilities ?? []).filter(
                (a) => !a.useStack
            );
            if (abilities.length < 2) continue;

            const keysByShape = new Map<Shape, Set<string>>();
            for (const a of abilities) {
                for (const shape of new Set(outputShapes(a))) {
                    const set = keysByShape.get(shape) ?? new Set<string>();
                    set.add(reversalKey(a));
                    keysByShape.set(shape, set);
                }
            }
            for (const [shape, keys] of keysByShape) {
                if (keys.size > 1) {
                    offenders.push(
                        `${card.name}: output ${shape} is produced by mana abilities with different restriction/rider`
                    );
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
