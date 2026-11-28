// bng — multicolor cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types are from Scryfall (id = BNG paper printing, ADR 0041).

import { defineCard, EFFECT_AFFECTS_SELF } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import type {
    PermanentView,
    StaticEffectContext,
    StaticEffectStateView,
} from "../../types";

// Xenagos, God of Revels — {3}{R}{G} Legendary Enchantment Creature — God,
// 6/5. Indestructible (CR 702.12b). The devotion line is a layer-4
// `type-remove` of its own Creature type (CR 613.1d), gated on a `condition`
// re-read at every derivation (CR 611.3a): CR 700.5's two-colour devotion
// counts each symbol that is red, green, or both ONCE, and CR 700.5a computes
// it before the type change applies, so Xenagos's own {R}{G} counts. The
// combat trigger targets another creature you control; `forEach` over the
// announced target binds `$each` as a snapshot taken when the ability
// resolves, so X is that creature's power determined once (CR 608.2h) and
// read for both halves of +X/+X.
// hand-tail: At the beginning of combat on your turn, another target creature you control gains haste and gets +X/+X until end of turn, where X is that creature's power. (#10544)
export const xenagosGodOfRevels = defineCard(() => ({
    id: "3184b138-1109-4195-9d96-4f190164e98b",
    name: "Xenagos, God of Revels",
    rarity: "mythic",
    oracleText:
        "Indestructible\nAs long as your devotion to red and green is less than seven, Xenagos isn't a creature.\nAt the beginning of combat on your turn, another target creature you control gains haste and gets +X/+X until end of turn, where X is that creature's power.",
    manaCost: { X: 3, R: 1, G: 1 },
    supertypes: ["Legendary"],
    types: ["Enchantment", "Creature"],
    subtypes: ["God"],
    power: 6,
    toughness: 5,
    staticAbilities: ["indestructible"],
    staticEffects: [
        {
            kind: "type-remove",
            applies: EFFECT_AFFECTS_SELF,
            condition: (
                source: PermanentView,
                state: StaticEffectStateView,
                ctx: StaticEffectContext
            ) => ctx.getDevotion(state, source.controllerId, ["R", "G"]) < 7,
            types: ["Creature"],
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "xenagos-god-of-revels-combat-pump",
            oracleText:
                "At the beginning of combat on your turn, another target creature you control gains haste and gets +X/+X until end of turn, where X is that creature's power.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                excludeSource: true,
            },
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        {
                            op: "grantAbility",
                            ability: "haste",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: { ref: "$each.power" },
                            toughness: { ref: "$each.power" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        }),
    ],
}));
