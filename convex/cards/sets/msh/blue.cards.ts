// MSH — blue cards, split by colour per ADR 0043. The registry's
// `import * as msh from "./sets/msh/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// The Wondrous Wasp — {1}{U} Legendary Creature — Human Hero, 2/1 (MSH, issue
// #7256, parent #4243). "Flash. Flying. Wasp's Sting — When The Wondrous Wasp
// enters, tap up to one target creature. It loses all abilities for as long as
// The Wondrous Wasp remains on the battlefield." DSL-first (ADR 0045) — no
// `resolve()`.
//
// "Wasp's Sting" is an ABILITY WORD (CR 207.2c): no rules meaning, no
// Mechanics Registry row; it survives only inside `oracleText`.
//
// ETB (CR 603.6a): "up to one target creature" is `count: { min: 0, max: 1 }`
// (CR 601.2c — zero targets is legal). Two Ops read the SAME announced slot:
//   1. `tapUntap` (CR 701.26a) — tap it.
//   2. `loseAllAbilitiesWhileSourceRemains` (CR 613.1f layer 6, CR 611.2b
//      "for as long as . . ."; Tishana's Tidebinder precedent, lci/blue) —
//      torn down the moment the Wasp leaves the battlefield. Both Ops no-op
//      when the slot is empty or the target left the battlefield (CR 608.2b).
//
// Guard C (issue #2701): the grammar does not consume the ability-word prefix
// with the tap-and-strip clause (gap corpus 1, below the floor).
// hand-tail: Wasp's Sting — When {self} enters, tap up to one target creature. It loses all abilities for as long as {self} remains on the battlefield (#7256)
export const theWondrousWasp = defineCard(() => ({
    id: "484e80a4-1d5f-4c27-98a8-ee2ef9d6cbdc",
    name: "The Wondrous Wasp",
    rarity: "rare",
    oracleText:
        "Flash\nFlying\nWasp's Sting — When The Wondrous Wasp enters, tap up to one target creature. It loses all abilities for as long as The Wondrous Wasp remains on the battlefield.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Hero"],
    power: 2,
    toughness: 1,
    // CR 702.8 Flash, CR 702.9 Flying.
    staticAbilities: ["flash", "flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "the-wondrous-wasp-etb",
            oracleText:
                "When The Wondrous Wasp enters, tap up to one target creature. It loses all abilities for as long as The Wondrous Wasp remains on the battlefield.",
            scope: "self",
            targetRequirement: { type: "Creature", count: { min: 0, max: 1 } },
            effects: [
                { op: "tapUntap", action: "tap", target: { target: 0 } },
                {
                    op: "loseAllAbilitiesWhileSourceRemains",
                    target: { target: 0 },
                },
            ],
        }),
    ],
}));
