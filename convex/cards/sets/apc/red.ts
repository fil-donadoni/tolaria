// APC — red cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Goblin Ringleader — {3}{R} 2/2 Goblin with haste (CR 702.10) whose ETB
// (CR 603.6a) is the deck's whole engine: "reveal the top four cards of your
// library. Put all Goblin cards revealed this way into your hand and the rest
// on the bottom of your library in any order."
//
// `lookDistribute` with `look === take === 4` and a `subtype: "Goblin"`
// filter: the filter alone decides what is KEEP-eligible (issue #1266 — the
// non-matching cards can never be kept), and `optional: false` makes the keep
// EXACTLY the clamped count, i.e. every revealed Goblin. `reveal: "window"`
// is the printed "reveal the top four" (CR 701.20a — the whole window is
// public, not a private Impulse-style look). The default
// `destination: "library-bottom"` is the "rest on the bottom ... in any
// order" clause: the bottom ORDER stays the controller's pick (ADR 0026 — no
// `randomBottom`, which is the Narset "in a RANDOM order" template instead).
//
// compiler-gap: When this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order. (#2693)
export const goblinRingleader: CardDefinition = {
    id: "b6b2cd77-9552-48b1-80cb-26966323c1ea", // APC 62
    rarity: "uncommon",
    name: "Goblin Ringleader",
    oracleText:
        "Haste\nWhen this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        enteredTrigger({
            id: "goblin-ringleader-dig",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    player: "controller",
                    look: 4,
                    take: 4,
                    keepTo: "hand",
                    filter: { subtype: "Goblin" },
                    optional: false,
                    reveal: "window",
                    prompt: "Put all Goblin cards revealed this way into your hand; the rest go on the bottom of your library in any order.",
                },
            ],
        }),
    ],
};
