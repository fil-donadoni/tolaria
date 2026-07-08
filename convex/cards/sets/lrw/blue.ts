// Lorwyn (LRW) — blue cards, split by colour per ADR 0043. The registry's
// `import * as lrw from "./sets/lrw"` resolves through lrw/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";

// Ponder — {U} Sorcery. "Look at the top three cards of your library, then put
// them back in any order. You may shuffle. Draw a card." Authored DSL-first as
// an Effect Script (ADR 0045, issue #885): the `scryReorder` Op with
// `destination: "none"` (every card stays on top, only the order changes — CR
// 401.4 look, CR 401 reorder) is the declarative skin over
// `SpellContext.orderTop` — it raises the `order-top` drag choice on the top 3
// and puts them back in the chosen order, marking them known to the caster (ADR
// 0026). Then an optional shuffle — a bare cost-free `mayPay` decision (issue
// #680) whose boolean outcome an `if` reads to run the `libraryLook` shuffle
// (CR 701.20, which clears that knowledge). Then the draw (CR 121.1). Each
// suspending Op checkpoints on its own Op index so a suspension never re-runs
// an earlier step (CR 608.3).
export const ponder: CardDefinition = {
    id: "ba6b6fc5-5077-4812-b8e9-906783dbaf67",
    name: "Ponder",
    rarity: "common",
    oracleText:
        "Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "scryReorder",
            player: "controller",
            count: 3,
            destination: "none",
            prompt: "Put these cards back on top in any order (rightmost = top).",
        },
        {
            op: "mayPay",
            player: "controller",
            prompt: "Shuffle your library (Ponder)?",
            bind: "$shuffle",
        },
        {
            op: "if",
            predicate: { binding: "$shuffle" },
            then: [
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
