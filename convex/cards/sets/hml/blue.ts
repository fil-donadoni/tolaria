// hml — blue cards, split by colour per ADR 0043. The registry's
// `import * as hml from "./sets/hml"` resolves through hml/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Memory Lapse — {1}{U} Instant. "Counter target spell. If that spell is
// countered this way, put it on top of its owner's library instead of into
// that player's graveyard." (CR 701.5a counter, the new `destination`
// parameter on `SpellContext.counter` — issue #683's "put it on top of its
// owner's library" redirect clause.) An unconditional counter — no
// mayPay/if — so the effect is a single Op.
export const memoryLapse: CardDefinition = {
    id: "30202613-d05f-4f47-af97-d0b75ccac293",
    rarity: "common",
    name: "Memory Lapse",
    oracleText:
        "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "counter",
            target: { target: 0 },
            destination: "library-top",
        },
    ],
};
