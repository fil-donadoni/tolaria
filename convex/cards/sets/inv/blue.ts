// Invasion (INV) — blue cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";

// Opt — {U} Instant. "Scry 1. Draw a card." (Modern Scryfall oracle text —
// the printed Invasion text differs, ADR 0004.) Authored DSL-first as an
// Effect Script (ADR 0045, issue #885/#1002) reusing already-shipped Ops: the
// `scryReorder` Op is the declarative skin over `SpellContext.orderTop` — Scry
// 1 (CR 701.22) with `destination: "library-bottom"` raises the `order-top`
// choice on the top card (projected face-up as `libraryPeek`), then on submit
// keeps it on top or sends it to the true bottom of the library. Then the draw
// (CR 121.1). scry resolves first, then draw.
export const opt: CardDefinition = {
    id: "958262ec-8e52-40cf-a9fd-a60e42643e15",
    name: "Opt",
    rarity: "common",
    oracleText:
        "Scry 1. (Look at the top card of your library. You may put that card on the bottom.)\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "scryReorder",
            player: "controller",
            count: 1,
            destination: "library-bottom",
            prompt: "Scry 1 — keep the card on top or send it to the bottom.",
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
