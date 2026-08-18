// jud — blue cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Flash of Insight — {X}{1}{U} Instant. "Look at the top X cards of your
// library. Put one of them into your hand and the rest on the bottom of your
// library in any order. Flashback—{1}{U}, Exile X blue cards from your
// graveyard." (Judgment, JUD 40.)
//
// The look/hand/bottom effect is the already-censused `lookDistribute` Op (CR 401.4,
// issue #984) with `look: { X: true }` (the announced X, issue #852) and the
// default `take: 1`: it reveals the top X, drives a suspending `look-top` pick
// of one card to keep (moved library → hand), and bottoms the rest. "In any
// order" is a formality auto-resolved in look order — the bottomed cards go
// face-down into the library, unknown, so no arrangement carries value.
//
// Flashback (CR 702.34, issue #693) makes the card castable from the graveyard
// for {1}{U} — its numeric generic pip means chosenX adds no mana on the
// flashback cast (CR 702.34a "rather than paying its mana cost"). The card
// carries a variable `{X}` pip, so chosenX is still announced on the flashback
// cast and drives the look count. The flashback's non-mana additional cost
// "Exile X blue cards from your graveyard" (CR 118.5) is a flashback-only cost
// (`additionalCosts.flashbackExileFromGraveyard`): it applies ONLY when the
// spell is cast from the graveyard, exiles exactly chosenX blue cards from the
// caster's own graveyard, and never the flashback card itself (CR 601.2a).
export const flashOfInsight: CardDefinition = {
    id: "ffaab905-0b97-42c2-a1a3-1e72275caa82", // JUD 40
    rarity: "uncommon",
    name: "Flash of Insight",
    oracleText:
        "Look at the top X cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n" +
        "Flashback—{1}{U}, Exile X blue cards from your graveyard. (You may cast this card from your graveyard for its flashback cost, then exile it. You can't exile Flash of Insight to pay for its own flashback cost.)",
    manaCost: { X: "X", generic: 1, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: { X: true },
            take: 1,
        },
    ],
    flashback: { U: 1, generic: 1 },
    additionalCosts: {
        flashbackExileFromGraveyard: { color: "U" },
    },
};
