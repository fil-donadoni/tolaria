// LTR — blue cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { typecyclingAbility } from "../../abilities/cycling";

// Lórien Revealed — {3}{U}{U} Sorcery. "Draw three cards. Islandcycling {1}
// ({1}, Discard this card: Search your library for an Island card, reveal
// it, put it into your hand, then shuffle.)" (Issue #1839 completed the
// card: it previously shipped as a plain "Draw three cards" sorcery with the
// Islandcycling mode absent.)
//
// The cycling half is a normal activated ability on a NONPERMANENT card —
// CR 702.29a's "functions only while the card is in a player's hand" is
// exactly what `activateFromHand` gates, so a sorcery carries it the same way
// a land or creature does.
export const lorienRevealed: CardDefinition = {
    id: "0ce44270-a684-4489-9077-521456e6dfaa",
    name: "Lórien Revealed",
    rarity: "common",
    manaCost: { X: 3, U: 2 },
    types: ["Sorcery"],
    oracleText:
        "Draw three cards.\nIslandcycling {1} ({1}, Discard this card: Search your library for an Island card, reveal it, put it into your hand, then shuffle.)",
    effects: [{ op: "draw", player: "controller", count: 3 }],
    // CR 702.29e/f — Islandcycling {1}.
    activatedAbilities: [typecyclingAbility({ generic: 1 }, "Island")],
};

// Stern Scolding — {U} Instant. "Counter target creature spell with power or
// toughness 2 or less." (CR 701.6a counter, CR 114.1 + 208.2 the new
// `spellCreaturePtFilter` targeting restriction, issue #683 — a stack-item
// power/toughness gate on a "spell" target that didn't exist before this
// card). No mayPay/if — an unconditional counter, so the effect is a single
// Op.
export const sternScolding: CardDefinition = {
    id: "3ca1e1de-b916-445f-b3b2-0f4d0cc7ceeb",
    rarity: "uncommon",
    name: "Stern Scolding",
    oracleText:
        "Counter target creature spell with power or toughness 2 or less.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Creature",
        spellCreaturePtFilter: { maxPowerOrToughness: 2 },
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};
