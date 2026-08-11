// Combo registry — all registered combo annotations. Imported as a side-effect
// from evaluate.ts so every combo is loaded before the first evaluation.
//
// Add new combos here. Each entry declares required pieces, stage boosts, and
// optional mana requirements.

import { registerCombo, type ComboAnnotation } from "./comboAnnotations";

// --- Card definition IDs ----------------------------------------------------
const DECEIVER_EXARCH_ID = "1f123ad6-fe84-4fed-9c0f-6b41921e9c26";
const SPLINTER_TWIN_ID = "2f8f22fb-7291-4517-9b15-e98501f2856b";

// --- Combo definitions ------------------------------------------------------

const SPLINTER_TWIN_COMBO: ComboAnnotation = {
    id: "splinter-twin-combo",
    name: "Splinter Twin + Deceiver Exarch",
    pieces: [
        {
            cardId: DECEIVER_EXARCH_ID,
            zone: "battlefield",
            controller: "you",
            untapped: true,
        },
        {
            cardId: SPLINTER_TWIN_ID,
            zone: "any",
        },
    ],
    manaRequired: 4, // {2}{R}{R}
    stages: [
        { piecesRequired: 1, boost: 200 },
        {
            piecesRequired: 2,
            boost: 5000,
        },
    ],
};

registerCombo(SPLINTER_TWIN_COMBO);
