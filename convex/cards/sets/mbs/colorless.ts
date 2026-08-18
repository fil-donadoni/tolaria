// MBS — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mbs from "./sets/mbs"` resolves through mbs/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { shuffleFromAnywhereReplacement } from "../../abilities/shuffleFromAnywhereReplacement";

const BLIGHTSTEEL_COLOSSUS_ID = "7928bb14-7631-4830-a756-26d1ea832ba2";

// Blightsteel Colossus — {12} Artifact Creature — Phyrexian Golem, 11/11
// (issue #1201, split from #699 — Vintage Cube PRD #620). "Trample, infect,
// indestructible\nIf Blightsteel Colossus would be put into a graveyard from
// anywhere, reveal Blightsteel Colossus and shuffle it into its owner's
// library instead." (CR 702.12b indestructible, CR 701.24 shuffle a card
// into a library, CR 702.19 trample, CR 702.90 infect.)
//
// "would be put ... instead" (CR 614.1a) is a TRUE replacement effect: the
// card never occupies the graveyard, not even momentarily — no
// `CREATURE_DIED`/`CARD_DISCARDED`/`CARD_MILLED`/`CARD_PUT_INTO_GRAVEYARD`
// may fire for it (issue #2106 — a prior revision of this file modeled it as
// a `zone: "graveyard"` triggered ability instead, which let the card
// genuinely die first and spuriously fire every "whenever a creature dies"
// permanent on the battlefield, e.g. Soul Net, `lea/colorless.ts`). Uses the
// shared `shuffleFromAnywhereReplacement` factory
// (`abilities/shuffleFromAnywhereReplacement.ts`), whose own doc comment
// covers the mechanism (`ReplacementEffect.appliesFromAnyZone`,
// `gre/replacements.ts`) and why it does NOT apply to Worldspine Wurm /
// Emrakul, the Aeons Torn, whose Oracle wording ("When ~ IS put into a
// graveyard from anywhere...", no "would"/"instead") is a genuine CR 603
// trigger, not a replacement — verified against Scryfall's current oracle
// text.
export const blightsteelColossus: CardDefinition = {
    id: BLIGHTSTEEL_COLOSSUS_ID,
    rarity: "mythic",
    name: "Blightsteel Colossus",
    oracleText:
        "Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.",
    manaCost: { generic: 12 },
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Golem"],
    power: 11,
    toughness: 11,
    staticAbilities: ["trample", "infect", "indestructible"],
    replacementEffects: [
        shuffleFromAnywhereReplacement({
            id: "blightsteel-colossus-shuffle",
            oracleText:
                "If Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.",
        }),
    ],
};
