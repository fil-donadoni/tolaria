// LCI — green cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, type GameEvent, type PermanentView } from "../../types";
import { createMapTokenOp } from "../../abilities/tokens/mapToken";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Sentinel of the Nameless City — {2}{G} Creature — Merfolk Warrior Scout 3/4
// (LCI, issue #2376, parent PRD #1525). "Vigilance. Whenever this creature
// enters or attacks, create a Map token."
//
// The card that earned Explore (CR 701.44) its Effect Op. Two seams, neither
// of them card-shaped:
//
// 1. ONE Oracle line spanning two engine events (CR 603.2) => ONE
//    `TriggeredAbility` with an array `event` and a discriminating `matches`,
//    the Sin, Spira's Punishment shape (`fin/multicolor.cards.ts`). Two abilities
//    would put two separate triggers on the stack off one line.
// 2. The Map token is the SHARED `MAP_TOKEN_SPEC`
//    (`abilities/tokens/mapToken.ts`), so every Map in the game — this one and
//    Get Lost's two, when that card ships — is one synthesized token
//    definition with one art and one client rehydration path. The token's own
//    activated ability is where Explore actually happens; this card never
//    mentions the keyword.
export const sentinelOfTheNamelessCity = defineCard(() => ({
    id: "eeeffc0b-dc92-458e-ad58-86ff6077a508",
    name: "Sentinel of the Nameless City",
    rarity: "uncommon",
    oracleText:
        'Vigilance\nWhenever this creature enters or attacks, create a Map token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.")',
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Warrior", "Scout"],
    power: 3,
    toughness: 4,
    staticAbilities: ["vigilance"],
    triggeredAbilities: [
        {
            id: "sentinel-of-the-nameless-city-map",
            oracleText:
                "Whenever this creature enters or attacks, create a Map token.",
            // CR 603.2 — ONE Oracle line spanning two engine events, so ONE
            // ability with an array `event` (the Sin, Spira's Punishment shape,
            // `fin/multicolor.cards.ts`); two abilities would render twice on the
            // stack off a single printed line.
            event: ["PERMANENT_ENTERED", "ATTACKERS_DECLARED"],
            etbAbility: false, // issue #4758
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "PERMANENT_ENTERED" &&
                    event.instanceId === self.id) ||
                (event.type === "ATTACKERS_DECLARED" &&
                    event.attackerIds.includes(self.id)),
            effects: [createMapTokenOp()],
        },
    ],
}));

// Spelunking — {2}{G} Enchantment (LCI, issue #9645). "When this enchantment
// enters, draw a card, then you may put a land card from your hand onto the
// battlefield. If you put a Cave onto the battlefield this way, you gain 4
// life.\nLands you control enter untapped."
//
// Two debts, one marker. The Cave rider is below the Hand Tail floor (issue
// #9645), so the trigger is written by hand. The static line is still an open
// Grammar Gap above the floor (issue #8586), and a card carrying such a gap
// may not wear the Hand Tail marker, so it wears the Grammar Gap one.
// The land put in is the Uro shape (`choose-hand-card` + `moveZone`, CR 400.7);
// `moveZone.bind` snapshots the permanent that entered and the rider reads it
// back through `objectMatchesFilter`, false when the player declined (nothing
// bound). "Lands you control enter untapped" is the compiled replacement
// static (CR 614.1d), the descriptor the grammar emits for it.
//
// compiler-gap: Lands you control enter untapped. (#8586)
export const spelunking = defineCard(() => ({
    id: "d3be4257-2316-4a2e-b347-f71c0368a947",
    name: "Spelunking",
    rarity: "uncommon",
    oracleText:
        "When this enchantment enters, draw a card, then you may put a land card from your hand onto the battlefield. If you put a Cave onto the battlefield this way, you gain 4 life.\nLands you control enter untapped.",
    manaCost: { X: 2, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "spelunking-enters",
            oracleText:
                "When this enchantment enters, draw a card, then you may put a land card from your hand onto the battlefield. If you put a Cave onto the battlefield this way, you gain 4 life.",
            scope: "self",
            effects: [
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
                    bind: "$entered",
                },
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$entered" },
                        filter: { subtype: "Cave" },
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 4 }],
                },
            ],
        }),
    ],
    compiledStaticEffects: [
        {
            kind: "enters-untapped-replacement",
            id: "spelunking-lands-enter-untapped",
            oracleText: "Lands you control enter untapped.",
            filter: { types: ["Land"], controllerRelation: "you" },
        },
    ],
}));
