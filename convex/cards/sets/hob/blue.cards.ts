// HOB — blue cards, split by colour per ADR 0043. The registry's
// `import * as hob from "./sets/hob/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// BILBO, THIEF IN THE NIGHT
//   Static line: the "from anywhere other than your hand" cost modifier
//     (CR 601.2a / 601.2f), which also discounts the attack trigger's own cast.
//   Attack trigger: "you may cast ... from your graveyard" names no duration, so
//     the cast happens during this resolution (CR 608.2g). The pick refuses a
//     land, which is played and never cast (CR 116.2a), artifact lands included.
//   CR 614.1a: "If an instant or sorcery spell cast this way would be put into
//     your graveyard, exile it instead" scopes the `exilesOnResolve` rider to
//     the face cast (`exilesOnResolveForTypes`): a countered artifact spell
//     still goes to the graveyard.
//   CR 709.3a / 712.11c / 715.3a: "an artifact, instant, or sorcery spell" is
//     asked per face — the pick (`castFaceType`), the offer rows and the Op's
//     `spellTypes` — so an Adventure instant on a creature card is castable as
//     the Adventure alone.
// hand-tail: Whenever {self} attacks, you may cast an artifact, instant, or sorcery spell from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead. (#7227)
export const bilboThiefInTheNight = defineCard(() => ({
    id: "484c7f83-8339-4ae1-8350-68ce1f7d05a3",
    name: "Bilbo, Thief in the Night",
    rarity: "mythic",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Halfling", "Rogue"],
    power: 2,
    toughness: 2,
    oracleText:
        "Spells you cast from anywhere other than your hand cost {1} less to cast.\nWhenever Bilbo attacks, you may cast an artifact, instant, or sorcery spell from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead.",
    compiledStaticEffects: [
        {
            kind: "cost-modifier",
            spells: { controller: "you" },
            onlyOutsideAnnouncersHand: true,
            reduction: 1,
        },
    ],
    triggeredAbilities: [
        {
            id: "bilbo-thief-in-the-night-attack",
            oracleText:
                "Whenever Bilbo attacks, you may cast an artifact, instant, or sorcery spell from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    filter: {
                        castFaceType: ["Artifact", "Instant", "Sorcery"],
                        excludeType: "Land",
                    },
                    count: { min: 0, max: 1 },
                    prompt: "You may cast an artifact, instant, or sorcery spell from your graveyard.",
                    bind: "$picked",
                },
                {
                    op: "castDuringResolution",
                    card: { ref: "$picked" },
                    player: "controller",
                    source: "graveyard",
                    spellTypes: ["Artifact", "Instant", "Sorcery"],
                    exilesOnResolve: true,
                    exilesOnResolveForTypes: ["Instant", "Sorcery"],
                },
            ],
        },
    ],
}));
