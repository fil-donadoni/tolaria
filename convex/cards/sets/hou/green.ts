// HOU — green cards, split by colour per ADR 0043. The registry's
// `import * as hou from "./sets/hou"` resolves through hou/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Ramunap Excavator — {2}{G} Creature — Snake Cleric, 2/3. "You may play
// lands from your graveyard." A single bare declarative field, no `resolve()`
// and no Effect Script: `playsLandsFromGraveyard: true` is the CR
// 305.1-analog player-wide land-play permission (issue #1190), read live off
// the battlefield by `canPlayLandsFromGraveyard` (`convex/gre/rules.ts`), so
// the permission ends the instant this creature leaves play — no stale flag.
// Same shape as Icetill Explorer (`eoe/green.ts`) and Crucible of Worlds
// (`5dn/colorless.ts`); the source's card type is irrelevant to the
// permission scan.
export const ramunapExcavator: CardDefinition = {
    id: "90a54d18-8403-441d-a115-ee462fabdabb",
    name: "Ramunap Excavator",
    rarity: "rare",
    oracleText: "You may play lands from your graveyard.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Snake", "Cleric"],
    power: 2,
    toughness: 3,
    playsLandsFromGraveyard: true,
};
