// SHM — colorless cards, split by colour per ADR 0043. The registry's
// `import * as shm from "./sets/shm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { asEntersColorModes } from "../../abilities/chooseColor";
import { defineCard } from "../../types";

// Painter's Servant — {2} Artifact Creature — Scarecrow, 1/3.
// CR 614.12a — the colour is chosen as the creature ENTERS, on every entry
// path; the answer lands on `chosenModeId` (`applyAsEntersAnswer`).
// CR 109.2a / CR 109.2b — the text names cards outside the battlefield and
// spells as well as permanents, hence `affectsEveryZone` with `applies` true for
// every object. CR 105.3 — "in addition to their other colors": additive.
// hand-tail: All cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors. (#7244)
export const paintersServant = defineCard(() => ({
    id: "be407a81-b25a-4e5d-845e-be0cc0d18db8",
    name: "Painter's Servant",
    rarity: "rare",
    oracleText:
        "As this creature enters, choose a color.\nAll cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors.",
    manaCost: { X: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Scarecrow"],
    power: 1,
    toughness: 3,
    entersWith: { asEnters: [{ kind: "mode" }] },
    modes: asEntersColorModes(),
    staticEffects: [
        {
            kind: "color-grant",
            applies: () => true,
            colors: "chosen-color",
            affectsEveryZone: true,
        },
    ],
}));
