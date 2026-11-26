// TRK — green cards, split by colour per ADR 0043. The registry's
// `import * as trk from "./sets/trk/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// U.S.S. Voyager, Lone Wanderer — {3}{G} Legendary Artifact — Spacecraft
// (modern Tron, issue #10561).
//   - "When U.S.S. Voyager enters, reveal cards from the top of your library
//     until you reveal two land cards. Put those land cards onto the
//     battlefield tapped and the rest on the bottom of your library in a
//     random order." — `revealUntilMatch` with `matchCount: 2`, `tapped`
//     and `rest: "libraryBottomRandom"` (CR 701.20a reveal; a library with
//     fewer than two lands is revealed whole, CR 609.3).
//   - Station + "8+ | Flying, vigilance" with the 3/3 box — declared as
//     `stationThresholds` data (CR 702.184a, CR 721.2b); no top-level P/T.
// hand-tail: When {self} enters, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order. (#10561)
export const ussVoyagerLoneWanderer = defineCard(() => ({
    id: "aaf8a0b2-c6cb-41cb-913d-7ae1d75e555d", // TRK 222
    name: "U.S.S. Voyager, Lone Wanderer",
    rarity: "uncommon",
    oracleText:
        "When U.S.S. Voyager enters, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n8+ | Flying, vigilance",
    manaCost: { X: 3, G: 1 },
    supertypes: ["Legendary"],
    types: ["Artifact"],
    subtypes: ["Spacecraft"],
    triggeredAbilities: [
        enteredTrigger({
            id: "uss-voyager-lone-wanderer-etb-lands",
            oracleText:
                "When U.S.S. Voyager enters, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order.",
            scope: "self",
            effects: [
                {
                    op: "revealUntilMatch",
                    player: "controller",
                    filter: { type: "Land" },
                    matchCount: 2,
                    match: "battlefield",
                    tapped: true,
                    rest: "libraryBottomRandom",
                },
            ],
        }),
    ],
    stationThresholds: [
        {
            charge: 8,
            creature: { power: 3, toughness: 3 },
            keywords: ["flying", "vigilance"],
        },
    ],
}));
