// MIR — blue cards, split by colour per ADR 0043. The registry's
// `import * as mir from "./sets/mir"` resolves through mir/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Mystical Tutor — {U} Instant. "Search your library for an instant or
// sorcery card, reveal it, then shuffle and put that card on top." (CR
// 701.19 search / 701.20 reveal + shuffle / 401.4 top-of-library, issue
// #1125 — unblocked by the `moveZone` `to: "library-top"` destination.)
// `filter.type: ["Instant", "Sorcery"]` is the type restriction (CR 205.4a
// OR-of-array, ADR 0045); `count: { min: 0, max: 1 }` is CR 701.19b's
// fail-to-find allowance. The `reveal` Op stamps the found card known to
// every player BEFORE the shuffle clears library knowledge (issue #945 —
// the reveal survives because it targets the picked id directly, not "the
// current top card"); the shuffle then runs, and the `library-top` move
// relocates the (now-shuffled) picked card to the front, per the oracle
// text's own ordering.
export const mysticalTutor: CardDefinition = {
    id: "5d98101f-e32a-4a4a-a649-faa920d111ee",
    name: "Mystical Tutor",
    rarity: "uncommon",
    manaCost: { U: 1 },
    types: ["Instant"],
    oracleText:
        "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            filter: { type: ["Instant", "Sorcery"] },
            count: { min: 0, max: 1 },
            prompt: "Search your library for an instant or sorcery card.",
            bind: "$picked",
        },
        { op: "reveal", player: "controller", cards: { ref: "$picked" } },
        { op: "libraryLook", action: "shuffle", player: "controller" },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "library-top",
        },
    ],
};
