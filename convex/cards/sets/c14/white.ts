// C14 — white cards, split by colour per ADR 0043. The registry's
// `import * as c14 from "./sets/c14"` resolves through c14/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Containment Priest — issue #1148, Vintage Cube FREE tranche (issue #686).
// "Flash. If a nontoken creature would enter and it wasn't cast, exile it
// instead." Flash is a shipped keyword (mechanicsRegistry.ts). The
// replacement clause is a permanent-bound `replacementEffects[]` entry
// (ADR 0020 pattern) on the new `"enters-battlefield"` `ReplacementEventKind`
// (`gre/replacements.ts::applyEnterBattlefieldReplacements`, issue #1148),
// fired at every chokepoint that places a permanent on the battlefield:
// cast-resolution (`wasCast: true`), reanimation/tutor-to-battlefield/hand-
// cheat (`stageReanimatedOnBattlefield`, `wasCast: false`), and token
// creation (`createToken`, `isToken: true` — exempt regardless of
// `wasCast`). `appliesTo` deliberately does not scope on `self` — the
// printed clause has no "you control" qualifier, so it intercepts ANY
// nontoken creature entering, either player's. A redirected creature never
// actually touches the battlefield, so no ETB trigger observes it (matches
// the printed ruling).
export const containmentPriest: CardDefinition = {
    id: "c2c794b9-09da-49be-b258-b0e21f1663e3", // C14 5
    name: "Containment Priest",
    rarity: "rare",
    oracleText:
        "Flash\nIf a nontoken creature would enter and it wasn't cast, exile it instead.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flash"],
    replacementEffects: [
        {
            id: "containment-priest-exile-uncast-creature",
            oracleText:
                "If a nontoken creature would enter and it wasn't cast, exile it instead.",
            eventKind: "enters-battlefield",
            appliesTo: (event) => {
                if (event.kind !== "enters-battlefield") return false;
                if (event.isToken || event.wasCast) return false;
                return event.types.includes("Creature");
            },
            replace: (event) => {
                if (event.kind !== "enters-battlefield") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                };
            },
        },
    ],
};
