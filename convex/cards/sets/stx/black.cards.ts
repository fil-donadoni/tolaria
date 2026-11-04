// stx — black cards (ADR 0043 colour split).
import { defineCard } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { PEST_TOKEN } from "../../sharedTokens";

// Sedgemoor Witch — {2}{B} Creature — Human Warlock, 3/2. Menace and
// Ward—Pay 3 life are data-only keywords; Magecraft is one triggered ability
// on both `SPELL_CAST` and `SPELL_COPIED` (CR 707.10, CR 603.2).
// hand-tail: Magecraft — Whenever you cast or copy an instant or sorcery spell, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life." (#2087)
export const sedgemoorWitch = defineCard(() => ({
    id: "e900c1eb-968b-4046-b824-c167a7a5b682",
    name: "Sedgemoor Witch",
    rarity: "rare",
    oracleText:
        'Menace\nWard—Pay 3 life.\nMagecraft — Whenever you cast or copy an instant or sorcery spell, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."',
    manaCost: { generic: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warlock"],
    power: 3,
    toughness: 2,
    staticAbilities: ["menace", "ward—pay 3 life"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "sedgemoor-witch-magecraft",
            oracleText:
                'Magecraft — Whenever you cast or copy an instant or sorcery spell, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."',
            scope: "you",
            alsoOnCopy: true,
            filter: { types: ["Instant", "Sorcery"] },
            effects: [
                {
                    op: "createToken",
                    token: PEST_TOKEN,
                    controller: "controller",
                },
            ],
        }),
    ],
}));
