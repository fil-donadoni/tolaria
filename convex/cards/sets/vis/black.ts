// VIS — black cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Vampiric Tutor — {B} Instant. "Search your library for a card, then
// shuffle and put that card on top. You lose 2 life." (CR 701.19 search /
// 701.20 shuffle / 401.4 top-of-library / 119.3 life loss, issue #1125 —
// unblocked by the `moveZone` `to: "library-top"` destination.)
// `count: { min: 0, max: 1 }` is CR 701.19b's fail-to-find allowance (no
// filter — "a card" is any card). The shuffle Op runs BEFORE the
// `library-top` move, mirroring the oracle text's own "then shuffle and put
// that card on top" ordering; the life loss is unconditional and runs last.
export const vampiricTutor: CardDefinition = {
    id: "0a07cba3-2e8d-48ec-a6f8-4d2edfcd833d",
    name: "Vampiric Tutor",
    rarity: "rare",
    manaCost: { B: 1 },
    types: ["Instant"],
    oracleText:
        "Search your library for a card, then shuffle and put that card on top. You lose 2 life.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: { min: 0, max: 1 },
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "library-top",
        },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};

// Necromancy — {2}{B} Enchantment. "You may cast this spell as though it had
// flash. If you cast it any time a sorcery couldn't have been cast, the
// controller of the permanent it becomes sacrifices it at the beginning of
// the next cleanup step. When this enchantment enters, if it's on the
// battlefield, it becomes an Aura with 'enchant creature put onto the
// battlefield with Necromancy.' Put target creature card from a graveyard
// onto the battlefield under your control and attach this enchantment to it.
// When this enchantment leaves the battlefield, that creature's controller
// sacrifices it." (CR 400.7 reanimation.) UNBLOCKED — no engine gap remains,
// authoring only. All three pieces the self-transform-and-dynamic-attach
// pattern needs have shipped: `addSubtype` (`convex/cards/types.ts`) turns
// $source into an Aura mid-resolution; `attach` (`types.ts`, executor
// `convex/gre/effects/interpreter.ts`) targets a BOUND ref from the same
// resolution — Cori-Steel Cutter creates a token, binds it (`$monk`), then
// attaches to `{ ref: "$monk" }` in one script (`tdm/red.ts`); and
// `leftTrigger`/`PERMANENT_LEFT` (`convex/cards/abilities/triggers/leftTrigger.ts`)
// covers the sacrifice-on-leave clause, with Dance of the Dead
// (`ice/black.ts`) as the near precedent (also an Aura-reanimation card with
// a leftTrigger sacrifice).
// tracked-by: #1965
// export const necromancy: CardDefinition = {
//     id: "311a6257-dd77-4bb6-81cb-c8e7862350f3",
//     name: "Necromancy",
//     rarity: "uncommon",
//     manaCost: { X: 2, B: 1 },
//     types: ["Enchantment"],
// };
