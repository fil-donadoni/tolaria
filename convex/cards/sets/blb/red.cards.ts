// blb — red cards (ADR 0043 colour split).

import { defineCard } from "../../types";
import { CLASS_SUBTYPE, classLevelOf } from "../../abilities/classLevels";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Artist's Talent — {1}{R} Enchantment — Class (CR 716).
// Level 1 (top section, CR 716.3): the cast-loot trigger. Level 2 bar: the
// noncreature cost reduction, a gateable static. Level 3 bar: a damage
// replacement (CR 614.1a), which `ClassLevelBarDefinition` has no slot for, so
// it sits on the definition and gates itself on `classLevelOf(self) >= 3`
// (CR 716.2a: the ability exists only at level 3 or greater).
//
// CR 614.1 / 120.2a — "noncombat damage" is `!event.isCombat`; the source is
// "a source you control" (`sourceControllerId`, CR 109.5) and the recipient is
// an opponent or a permanent an opponent controls (CR 102.2 / 109.4).
// CR 614.5 — each damage event is a separate event, so +2 applies to each.
// hand-tail: If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead. (#8595)
export const artistsTalent = defineCard(() => ({
    id: "ea734863-5793-49d6-b10e-109432aec0a3", // BLB
    rarity: "rare",
    name: "Artist's Talent",
    oracleText:
        "(Gain the next level as a sorcery to add its ability.)\nWhenever you cast a noncreature spell, you may discard a card. If you do, draw a card.\n{2}{R}: Level 2\nNoncreature spells you cast cost {1} less to cast.\n{2}{R}: Level 3\nIf a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    subtypes: [CLASS_SUBTYPE],
    triggeredAbilities: [
        spellCastTrigger({
            id: "artists-talent-loot",
            oracleText:
                "Whenever you cast a noncreature spell, you may discard a card. If you do, draw a card.",
            scope: "you",
            filter: { excludeTypes: "Creature" },
            effects: [
                {
                    // 0 picks makes the discard and the draw no-ops: that IS
                    // "if you do" (same shape as Fable of the Mirror-Breaker's
                    // sibling "up to" loots).
                    op: "choice",
                    kind: "discard-hand",
                    player: "controller",
                    zone: "hand",
                    count: { min: 0, max: 1 },
                    prompt: "You may discard a card. If you do, draw a card.",
                    bind: "$disc",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$disc" },
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$disc" },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        }),
    ],
    classLevelBars: [
        {
            level: 2,
            cost: { X: 2, R: 1 },
            costLabel: "{2}{R}",
            staticEffects: [
                {
                    kind: "cost-modifier",
                    // CR 601.2a — "spells YOU cast" reads the caster.
                    appliesToSpell: (card, _ctx, effectSource, announcerId) =>
                        !card.types.includes("Creature") &&
                        announcerId !== undefined &&
                        announcerId === effectSource?.controllerId,
                    costReduction: { X: 1 },
                },
            ],
        },
        { level: 3, cost: { X: 2, R: 1 }, costLabel: "{2}{R}" },
    ],
    replacementEffects: [
        {
            id: "artists-talent-damage-plus-two",
            oracleText:
                "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.",
            eventKind: "damage",
            damageEffectKind: "other",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (classLevelOf(self) < 3) return false;
                if (event.isCombat || event.amount <= 0) return false;
                if (event.sourceControllerId !== self.controllerId)
                    return false;
                if (event.target.type === "player") {
                    return event.target.id !== self.controllerId;
                }
                if (event.target.type !== "permanent") return false;
                const targetId = event.target.id;
                for (const p of state.players) {
                    const perm = p.battlefield.find((c) => c.id === targetId);
                    if (perm) return perm.controllerId !== self.controllerId;
                }
                return false;
            },
            replace: (event) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                return {
                    kind: "modified",
                    event: { ...event, amount: event.amount + 2 },
                };
            },
        },
    ],
}));
