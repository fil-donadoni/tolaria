// Urza's Destiny (UDS) — white cards (ADR 0043 colour split).
// Modern Scryfall oracle text is authoritative (ADR 0004). Generic mana is
// encoded as `X: n` ({3}{W} → { X: 3, W: 1 }).

import type {
    CardDefinition,
    PermanentView,
    StaticEffectContext,
} from "../../types";

// CR 404 / 400.7 / 614-batch — a bulk graveyard-set sweep (issue #1056),
// returned as ONE simultaneous event (issue #1094). "Return all enchantment
// cards from your graveyard to the battlefield" is a `forEach` over the
// controller's graveyard filtered to enchantments, `simultaneous: true`: the
// interpreter hands the WHOLE frozen member set to
// `SpellContext.returnGraveyardSetToBattlefield` in one call instead of
// reanimating members one `moveZone` at a time, so no returned enchantment's
// static-effect grants or "enters the battlefield" trigger observe only some
// of the others already on the battlefield (Opalescence/Parallax-style
// interactions). The frozen member set is snapshotted once (CR 608.2i); a
// card leaving mid-resolution is skipped (CR 608.2b).
//
// Aura-with-nothing-to-enchant (CR 303.4c, issue #1094): an Aura in the swept
// set with no legal host — not even a non-Aura sibling entering as part of
// this SAME event — stays in the graveyard rather than entering unattached.
// SIMPLIFICATION: when more than one legal host exists, the batch primitive
// auto-picks the first one (deterministic order) — no player choice is
// modeled, matching this sweep's own "no per-card choice" design for which
// enchantments return.
export const replenish: CardDefinition = {
    id: "7fd2fe13-bbc0-42b7-bc42-3b51910ce118",
    rarity: "rare",
    name: "Replenish",
    oracleText:
        "Return all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)",
    manaCost: { X: 3, W: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: "controller",
                filter: { type: "Enchantment" },
            },
            simultaneous: true,
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$each" },
                    to: "battlefield",
                },
            ],
        },
    ],
};

/** CR 205 layer-4 / 613.4b — "each OTHER non-Aura enchantment" (target !==
 *  source, live `types`/`subtypes` so the set stays current with any earlier
 *  type/subtype-add layer, matching `IS_NONCREATURE_ARTIFACT`'s discriminator
 *  role for Titania's Song). Shared by Opalescence's type-add and pt-cda
 *  entries so both layers scan the identical set. */
const IS_OTHER_NON_AURA_ENCHANTMENT: (
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
) => boolean = (target, source, ctx) =>
    target.id !== source.id &&
    target.types.includes("Enchantment") &&
    !ctx.hasSubtype(target, "Aura");

// Opalescence — {2}{W}{W} Enchantment. "Each other non-Aura enchantment is a
// creature in addition to its other types and has base power and base
// toughness each equal to its mana value." (CR 205 layer-4 type-add + CR
// 613.4b layer-7b base P/T set from the target's own mana value — same
// two-layer CDA shape as Animate Artifact / Titania's Song, scoped to every
// OTHER non-Aura enchantment on the battlefield instead of a single Aura host
// or a noncreature-artifact set.) Unconditional (no "isn't already a
// creature" gate) — unlike Animate Artifact's host clause, Opalescence's text
// carries no such condition.
export const opalescence: CardDefinition = {
    id: "3c0071fb-afa5-47b5-b266-2b10a4f5a98a",
    rarity: "rare",
    name: "Opalescence",
    oracleText:
        "Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "type-add",
            applies: IS_OTHER_NON_AURA_ENCHANTMENT,
            types: ["Creature"],
        },
        {
            kind: "pt-cda",
            applies: IS_OTHER_NON_AURA_ENCHANTMENT,
            compute: (_source, _state, ctx, target) => {
                const mv = ctx.getManaValue(target);
                return { power: mv, toughness: mv };
            },
        },
    ],
};
