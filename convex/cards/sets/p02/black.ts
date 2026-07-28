// P02 — black cards, split by colour per ADR 0043. The registry's
// `import * as p02 from "./sets/p02"` resolves through p02/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Ravenous Rats — {1}{B} 1/1. "When this creature enters, target opponent
// discards a card." (CR 603.6a ETB, CR 701.9 discard.) "Target opponent" in
// a 2-player game is a relative `EffectPlayerRef`, so no `choice-as-target`
// substitute is needed at all — `player: "opponent"` addresses it directly
// (the discarding player also chooses which card, CR 701.8a default).
//
// Home set = earliest paper printing (ADR 0041) = Portal Second Age; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/black.ts`.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
export const ravenousRats: CardDefinition = {
    id: "8899244b-737a-43a9-9241-15a650b47bed", // P02 87
    rarity: "common",
    name: "Ravenous Rats",
    oracleText: "When this creature enters, target opponent discards a card.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Rat"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "ravenous-rats-etb",
            oracleText:
                "When this creature enters, target opponent discards a card.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: "opponent",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: "opponent",
                    cards: { ref: "$picked" },
                },
            ],
        }),
    ],
};
