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

// Flash — {1}{U} Instant. "You may put a creature card from your hand onto
// the battlefield. If you do, sacrifice it unless you pay its mana cost
// reduced by {2}." (Vintage Cube FREE tranche, issue #686.) The "put a
// creature from hand onto the battlefield" half reuses the existing
// picks-based `moveZone(hand->battlefield)` shape (Stoneforge Mystic,
// wwk/white.ts): `choice(kind: "choose-hand-card", zone: "hand", filter:
// {type: "Creature"}, count: {min:0, max:1})` binds `$picked`, then
// `moveZone` puts it into play. "sacrifice it unless you pay its mana cost
// reduced by {2}" is the `mayPay` Op's dynamically-derived cost leg (issue
// #1150 — `{ manaCostOf: {ref: "$picked"}, reducedBy: 2 }`): resolved at
// mayPay execution time by reading the just-entered permanent's own printed
// mana cost and reducing the generic portion by {2}, floored at {0} (CR
// 118.9). `if (not $paid) sacrifice($picked)` is the "unless" consequence
// (CR 117.3a) — a no-op when nothing was picked in the first place (an empty
// picks ref, CR 608.2b), since declining the initial "you may" never raises
// the mayPay prompt at all (`resolveMayPayCost` skips the whole Op when
// `$picked` is empty).
export const flash: CardDefinition = {
    id: "63af3c26-5b1f-46f6-9aa2-036c615bf5ea", // MIR 66
    name: "Flash",
    rarity: "rare",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    oracleText:
        "You may put a creature card from your hand onto the battlefield. If you do, sacrifice it unless you pay its mana cost reduced by {2}.",
    effects: [
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            filter: { type: "Creature" },
            count: { min: 0, max: 1 },
            prompt: "Put a creature card from your hand onto the battlefield (or none).",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "hand",
            to: "battlefield",
        },
        {
            op: "mayPay",
            player: "controller",
            cost: { manaCostOf: { ref: "$picked" }, reducedBy: 2 },
            prompt: "Pay its mana cost reduced by {2}?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "sacrifice", permanents: { ref: "$picked" } }],
        },
    ],
};
