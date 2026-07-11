// TMP — green cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Mirri's Guile — {G} Enchantment. "At the beginning of your upkeep, you may
// look at the top three cards of your library, then put them back in any
// order." Authored DSL-first as an Effect Script (ADR 0045): an upkeep
// `phaseTrigger` (CR 603.6a, `scope: "your"` — the scoped player IS the
// controller) whose `effects[]` are the cost-free "you may" gate (CR 117.3a,
// `mayPay` with no cost → boolean bind) and, if accepted, the `scryReorder` Op
// with `destination: "none"` (a pure reorder — every looked-at card stays on
// top, only the order changes, CR 401.4 look + CR 401 reorder; unlike Scry it
// bottoms nothing). The Op is the declarative skin over `SpellContext.orderTop`
// and marks the cards known to the controller (ADR 0026). Each suspending Op
// checkpoints on its own Op index so a suspension never re-runs an earlier step
// (CR 608.3).
export const mirrisGuile: CardDefinition = {
    id: "73d51a3c-95c0-4810-b847-4b8afd12fd64",
    name: "Mirri's Guile",
    rarity: "rare",
    oracleText:
        "At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "mirris-guile-upkeep",
            oracleText:
                "At the beginning of your upkeep, you may look at the top three cards of your library, then put them back in any order.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Look at the top three cards of your library (Mirri's Guile)?",
                    bind: "$look",
                },
                {
                    op: "if",
                    predicate: { binding: "$look" },
                    then: [
                        {
                            op: "scryReorder",
                            player: "controller",
                            count: 3,
                            destination: "none",
                            prompt: "Put these cards back on top in any order (rightmost = top).",
                        },
                    ],
                },
            ],
        }),
    ],
};
