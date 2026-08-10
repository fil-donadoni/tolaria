// thb — multicolor cards (ADR 0043 colour split).

import type { CardDefinition, EffectOp } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// CR 702.138b — "sacrifice it unless it escaped": sacrifice $source when the
// escaped flag reads 0 (a NON-escape cast — from hand, or a blink). The escaped
// EffectValue resolves to 1 (escaped) or 0 (not); `< 1` selects the 0 case.
const sacrificeUnlessEscaped: EffectOp[] = [
    {
        op: "if",
        predicate: {
            left: { escaped: { of: { ref: "$source" } } },
            op: "lt",
            right: 1,
        },
        then: [{ op: "sacrifice", target: { ref: "$source" } }],
    },
];

// Uro's recurring value (fires on both enter and attack): gain 3 life, draw a
// card, then you MAY put a land card from your hand onto the battlefield
// (CR 121.1 draw, CR 119.3 life gain, CR 400.7 hand → battlefield via the
// choice + moveZone DSL pair).
const uroValue: EffectOp[] = [
    { op: "gainLife", player: "controller", amount: 3 },
    { op: "draw", player: "controller", count: 1 },
    {
        op: "choice",
        kind: "choose-hand-card",
        player: "controller",
        zone: "hand",
        filter: { type: "Land" },
        count: { min: 0, max: 1 },
        prompt: "You may put a land card from your hand onto the battlefield.",
        bind: "$land",
    },
    {
        op: "moveZone",
        cards: { ref: "$land" },
        player: "controller",
        from: "hand",
        to: "battlefield",
    },
];

// Uro, Titan of Nature's Wrath — {1}{G}{U} Legendary Creature — Elder Giant 6/6.
// "When Uro enters, sacrifice it unless it escaped." (CR 702.138b escaped test.)
// "Whenever Uro enters or attacks, you gain 3 life and draw a card, then you may
//  put a land card from your hand onto the battlefield."
// "Escape—{G}{G}{U}{U}, Exile five other cards from your graveyard." (CR 702.138.)
export const uroTitanOfNaturesWrath: CardDefinition = {
    id: "a0b6a71e-56cb-4d25-8f2b-7a4f1b60900d",
    name: "Uro, Titan of Nature's Wrath",
    rarity: "mythic",
    oracleText:
        "When Uro enters, sacrifice it unless it escaped.\nWhenever Uro enters or attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.\nEscape—{G}{G}{U}{U}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)",
    manaCost: { X: 1, G: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Elder", "Giant"],
    supertypes: ["Legendary"],
    power: 6,
    toughness: 6,
    triggeredAbilities: [
        enteredTrigger({
            id: "uro-sacrifice-unless-escaped",
            oracleText: "When Uro enters, sacrifice it unless it escaped.",
            scope: "self",
            effects: sacrificeUnlessEscaped,
        }),
        enteredTrigger({
            id: "uro-enters-value",
            oracleText:
                "Whenever Uro enters, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.",
            scope: "self",
            effects: uroValue,
        }),
        {
            id: "uro-attacks-value",
            oracleText:
                "Whenever Uro attacks, you gain 3 life and draw a card, then you may put a land card from your hand onto the battlefield.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: uroValue,
        },
    ],
    // CR 702.138 — Escape. {G}{G}{U}{U} + exile five OTHER graveyard cards.
    escape: { mana: { G: 2, U: 2 }, exile: { count: 5 } },
};
