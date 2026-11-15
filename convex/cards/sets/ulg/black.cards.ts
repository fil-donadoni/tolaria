// Urza's Legacy (ULG) — black cards, split by colour per ADR 0043. The
// registry's `import * as ulg from "./sets/ulg/index.cards"` re-exports this module.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import { defineCard } from "../../types";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";

// Engineered Plague — {2}{B} Enchantment. "As this enchantment enters, choose a
// creature type. All creatures of the chosen type get -1/-1." (CR 614.12a the
// on-entry choice; CR 205.3m the creature-type table; CR 613.4c layer 7c the
// -1/-1; CR 704.5f the toughness-0 SBA that makes it a one-sided sweeper
// against a 1-toughness tribe.)
//
// The choice is the `entersWith.asEnters` REPLACEMENT (CR 614.12a — "made
// before the permanent enters"), never a `PERMANENT_ENTERED` trigger: a trigger
// would use the stack and let priority pass with the type not yet chosen, so
// the -1/-1 would miss the SBA pass that should kill the tribe on entry. Same
// shape as Conspiracy (`sets/mmq/black.cards.ts`), and the option list is the same
// import of CR 205.3m's own table (`oracle/grammar/shared/subtypes.ts`,
// re-derived from the vendored Comprehensive Rules) — a local copy would rot
// the day Wizards prints a new creature type.
//
// "All creatures" is BOTH controllers' — no `controllerId` gate, which is the
// one line that separates this card from Conspiracy's "creatures you control".
// Reading the chosen type off `source.chosenSubtypes[0]` inside `applies` keeps
// it live: `pt-buff` is recomputed at every read (unlike the apply-time
// `keyword-grant` family), so a creature of the chosen type that enters LATER
// is buffed on arrival, and an effect that CHANGES a creature's types (layer 4,
// applied before layer 7c) is seen by this predicate on the next read.
export const engineeredPlague = defineCard(() => ({
    id: "27e158d5-efb2-4f90-8898-60ede98f7d29",
    name: "Engineered Plague",
    rarity: "uncommon",
    oracleText:
        "As this enchantment enters, choose a creature type.\nAll creatures of the chosen type get -1/-1.",
    manaCost: { X: 2, B: 1 },
    types: ["Enchantment"],
    entersWith: {
        asEnters: [
            { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
        ],
    },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) => {
                const chosen = source.chosenSubtypes?.[0];
                if (chosen === undefined) return false;
                return ctx.isCreature(target) && ctx.hasSubtype(target, chosen);
            },
            power: -1,
            toughness: -1,
        },
    ],
}));
