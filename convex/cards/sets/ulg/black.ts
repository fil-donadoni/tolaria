// Urza's Legacy (ULG) — black cards, split by colour per ADR 0043. The
// registry's `import * as ulg from "./sets/ulg"` resolves through ulg/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { cyclingAbility } from "../../abilities/cycling";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";

// Unearth — {B} Sorcery. "Return target creature card with mana value 3 or less
// from your graveyard to the battlefield." plus Cycling {2} (CR 702.29). The
// reanimation is the same targeted-graveyard-card → battlefield `moveZone`
// shape as Reanimate (tmp/black.ts); the `mvFilter: { max: 3 }` gates the
// target (CR 601.2c) as in Sevinne's Reclamation (c19/white.ts). The Cycling
// ability is the engine/cost capability from issue #689.
export const unearth: CardDefinition = {
    id: "b6cb2549-e485-44d6-9d65-7605c568909e",
    name: "Unearth",
    rarity: "common",
    oracleText:
        "Return target creature card with mana value 3 or less from your graveyard to the battlefield.\nCycling {2} ({2}, Discard this card: Draw a card.)",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
        mvFilter: { max: 3 },
    },
    // CR 400.7 — return the targeted graveyard creature card to the battlefield
    // under its owner's control (the caster).
    effects: [{ op: "moveZone", target: { target: 0 }, to: "battlefield" }],
    // CR 702.29 — Cycling {2}. Usable only from hand at instant speed.
    activatedAbilities: [cyclingAbility({ generic: 2 })],
};

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
// shape as Conspiracy (`sets/mmq/black.ts`), and the option list is the same
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
// compiler-gap: As this enchantment enters, choose a creature type. (#2693)
// compiler-gap: All creatures of the chosen type get -1/-1. (#2693)
export const engineeredPlague: CardDefinition = {
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
};
