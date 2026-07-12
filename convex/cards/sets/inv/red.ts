// INV — red cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition, SpellContext } from "../../types";

// Overload — "Kicker {2}. Destroy target artifact if its mana value is 2 or
// less. If this spell was kicked, destroy that artifact if its mana value is 5
// or less instead." (CR 702.33 Kicker — the on-resolution effect is DSL; only
// the optional additional cost lives in the engine `kicker` field.) The MV
// threshold, not the target set, changes with the kick, so there is no
// `kickedTargetRequirement`: the spell always targets an artifact and the
// `manaValue` value member (CR 202.3) gates the destroy at resolution.
// Vintage Cube Kicker cluster (issue #692, ADR 0041).
export const overload: CardDefinition = {
    id: "c91fca91-7296-422e-b251-d571b710ff71",
    rarity: "common",
    name: "Overload",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
    manaCost: { R: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 2 } },
    targetRequirement: { type: "Artifact", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { target: 0 } } },
                        op: "le",
                        right: 5,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
            else: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { target: 0 } } },
                        op: "le",
                        right: 2,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        },
    ],
};

// Obliterate — "This spell can't be countered. Destroy all artifacts,
// creatures, and lands. They can't be regenerated." (CR 701.5c can't-be-
// countered flag, issue #1065; CR 701.7 destroy + CR 701.15c regen
// suppression.)
//
// NOT DSL-migratable (ADR 0045, issue #831 precedent — Wrath of God is the
// first occurrence of this exact shape, Damnation the second, Jokulhaups the
// third, this the fourth): the `destroy` Op has no "can't be regenerated"
// option, so a `forEach`/`destroy` sweep would let a regeneration shield save
// a permanent (unlike this card). The fix is the existing shared primitive
// `SpellContext.destroyAll`, not a new one. Blocked on: a `cantBeRegenerated`
// option on the `destroy` Op.
export const obliterate: CardDefinition = {
    id: "cdabde40-2143-4677-b7b4-ea8fbf9b1f25",
    rarity: "rare",
    name: "Obliterate",
    oracleText:
        "This spell can't be countered.\nDestroy all artifacts, creatures, and lands. They can't be regenerated.",
    manaCost: { X: 6, R: 2 },
    types: ["Sorcery"],
    cantBeCountered: true,
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll(["Artifact", "Creature", "Land"], {
            cantBeRegenerated: true,
        });
    },
};

// Urza's Rage — "Kicker {8}{R}. This spell can't be countered. Urza's Rage
// deals 3 damage to any target. If this spell was kicked, instead it deals
// 10 damage to that permanent or player and the damage can't be prevented."
// (CR 701.5c can't-be-countered flag, issue #1065; CR 702.33 Kicker; CR 120.1
// damage; CR 615 prevention — the kicked mode's `unpreventable: true` skips
// prevention shields only, generalizing `dealDamage`'s existing preventable
// path — CR 614 replacement/redirection and CR 702.16 protection are
// untouched, same as every other `dealDamage` card.)
export const urzasRage: CardDefinition = {
    id: "61a25a35-3ae4-471e-adcd-d8baf2f77b68",
    rarity: "rare",
    name: "Urza's Rage",
    oracleText:
        "Kicker {8}{R} (You may pay an additional {8}{R} as you cast this spell.)\nThis spell can't be countered.\nUrza's Rage deals 3 damage to any target. If this spell was kicked, instead it deals 10 damage to that permanent or player and the damage can't be prevented.",
    manaCost: { X: 2, R: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 8, R: 1 } },
    cantBeCountered: true,
    targetRequirement: { type: "any", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "dealDamage",
                    amount: 10,
                    to: { target: 0 },
                    unpreventable: true,
                },
            ],
            else: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
        },
    ],
};
