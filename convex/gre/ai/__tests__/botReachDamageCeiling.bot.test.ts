// Bot-play sweep — a spell's literal damage to its creature target is a
// toughness ceiling (CR 704.5g: lethal damage is damage at least equal to
// toughness). The position's Castle gives untapped creatures +0/+2, so the
// opponent's 2/2 survives 3 damage as a 2/4: the spell kills nothing, the Bot
// rightly holds it, and the verdict read `never-chosen` about a position that
// never posed the removal. Verdicts go through the real `playBotReach`
// pipeline.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type {
    CardDefinition,
    EffectOp,
    TargetRequirement,
} from "../../../cards/types";
import { botReachSpec, playBotReach } from "../botReach";

const CREATURE_OR_PLANESWALKER: TargetRequirement = {
    type: ["Creature", "Planeswalker"],
    count: { min: 0, max: 1 },
};

function sorcery(
    effects: EffectOp[],
    targetRequirement: TargetRequirement = CREATURE_OR_PLANESWALKER
): CardDefinition {
    return {
        id: "probe-damage-ceiling",
        name: "Damage Ceiling Probe",
        rarity: "common",
        oracleText: "",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        targetRequirement,
        effects,
    } as CardDefinition;
}

const damage = (amount: number): EffectOp =>
    ({ op: "dealDamage", amount, to: { target: 0 } }) as EffectOp;

const holdsCastle = (def: CardDefinition): boolean =>
    botReachSpec(def).cards.some((c) => c.name === "Castle");

describe("botReachSpec — targeted damage as a toughness ceiling (CR 704.5g)", () => {
    it("drops the toughness boost when only the boost keeps the target alive", () => {
        expect(holdsCastle(sorcery([damage(3)]))).toBe(false);
    });

    it("keeps the boost when the damage kills the boosted body anyway", () => {
        expect(holdsCastle(sorcery([damage(4)]))).toBe(true);
    });

    it("keeps the boost when an enchantment is a legal target", () => {
        expect(
            holdsCastle(
                sorcery([damage(3)], {
                    type: ["Creature", "Enchantment"],
                    count: 1,
                })
            )
        ).toBe(true);
    });
});

describe("playBotReach — anti-prevention burn at a creature (CR 615.12)", () => {
    it("plays a damage-can't-be-prevented 3-damage sorcery at the opponent's 2/2", () => {
        const def = sorcery([
            { op: "suppressDamagePrevention" } as EffectOp,
            damage(3),
        ]);
        withTemporaryDefinition(def, () => {
            expect(playBotReach(def).outcome).toBe("played");
        });
    });
});
