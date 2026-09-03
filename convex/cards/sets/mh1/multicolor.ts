// mh1 — multicolor cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { WRENN_AND_SIX_EMBLEM_ID } from "../../emblems";
import { ninjutsuAbility } from "../../abilities/ninjutsu";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Hogaak, Arisen Necropolis — {5}{B/G}{B/G} Legendary Creature — Avatar, 8/8
// (issue #1338, PRD #702, ADR 0063). "You can't spend mana to cast this spell.
// Convoke, delve. You may cast this card from your graveyard. Trample."
//
// Exercises the whole payWith cluster this issue ships:
//   - `cantSpendManaToCast` (CR 601.2f) forces EVERY pip — the 5 generic AND
//     the two guild-hybrid {B/G} pips — through the non-mana payWith path; no
//     mana may be spent. `coloredCostLeftover` (gre/rules.ts) drops all real
//     mana sources for the castability probe, leaving only convoke creatures +
//     delve exiles. Since delve pays only generic (CR 702.66a), the two {B/G}
//     pips MUST be paid by convoke creatures that are black or green.
//   - `convoke` (CR 702.51) — the coloured payWith: each tapped creature pays a
//     generic OR one mana of its colour (so a B/G creature covers a {B/G} pip).
//   - `delve` (CR 702.66) — the generic payWith it shares the picker chain with.
//   - `castableFromOwnGraveyard` (CR 601.3) — "You may cast this card from your
//     graveyard" (resolves normally, lands in the graveyard — no exile).
//   - `trample` (CR 702.19).
// The two {B/G} pips are declared via `manaCost.hybrid` (issue #1338); the flat
// `X: 5` is the generic. Mana value 7, colours {B, G} — both derived from the
// hybrid pips (`manaValue` / `getColorsFromCost`). No `effects`/`resolve`: a
// vanilla-bodied creature whose entire rules text is keyword abilities + cost
// modifiers, so the DSL smoke sweep needs nothing from it.
export const hogaakArisenNecropolis: CardDefinition = {
    id: "0049e68d-0caf-474f-9523-dad343f1250a",
    rarity: "rare",
    name: "Hogaak, Arisen Necropolis",
    oracleText:
        "You can't spend mana to cast this spell.\nConvoke, delve (Each creature you tap while casting this spell pays for {1} or one mana of that creature's color. Each card you exile from your graveyard pays for {1}.)\nYou may cast this card from your graveyard.\nTrample",
    manaCost: {
        X: 5,
        hybrid: [
            ["B", "G"],
            ["B", "G"],
        ],
    },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Avatar"],
    power: 8,
    toughness: 8,
    staticAbilities: ["convoke", "delve", "trample"],
    cantSpendManaToCast: true,
    castableFromOwnGraveyard: true,
};

// Fallen Shinobi — {3}{U}{B} Creature — Zombie Ninja, 5/4 (MH1, issue #2390).
// "Ninjutsu {2}{U}{B}. Whenever this creature deals combat damage to a player,
// that player exiles the top two cards of their library. Until end of turn, you
// may play those cards without paying their mana costs."
//
// The card Ninjutsu (CR 702.49) shipped for, and the pool's only exposure of
// the keyword. The keyword half is entirely declarative — `ninjutsuAbility`
// (`convex/cards/abilities/ninjutsu.ts`) builds an ordinary `activateFromHand`
// activated ability whose body is a plain `moveZone` Effect Script; nothing
// about the keyword lives on this card.
//
// protocol card: the combat-damage trigger is a CROSS-PLAYER impulse draw —
// exile off the DAMAGED player's library, grant the ATTACKER the play
// permission — which has no Op skin (`grantCastFromExile`'s Op form consumes a
// preceding `choice(zone: "exile")` pick, and no choice happens here). Ragavan,
// Nimble Pilferer (`mh2/red.ts`) is the shipped precedent for exactly this
// shape, itself following Robber of the Rich (`eld/red.ts`); this trigger is
// that composition with N=2 and the two riders the Oracle text adds.
// `aiEffects` below is the shadow script the bot's value model walks, since a
// bare closure gives `cardValueById`/`latentValue` nothing to read.
//
// TWO riders distinguish it from Ragavan's line, both straight off the Oracle
// text. "PLAY those cards" (not "cast") is CR 305.9 — `includesLand: true`, so
// an exiled land is a legal land drop rather than a dead card (the bug issue
// #1689 fixed for Ragavan, which says "cast" and so correctly omits it).
// "without paying their mana costs" is CR 118.9 — `withoutPayingManaCost`,
// which for a land leg is simply vacuous (playing a land pays nothing).
//
// compiler-gap: "Ninjutsu {2}{U}{B}" (#2693) — the Oracle grammar has no rule
// for the keyword's activated-ability expansion.
export const fallenShinobi: CardDefinition = {
    id: "900c9dfd-ece1-4b09-a801-0fa05e1994b9", // MH1 199
    name: "Fallen Shinobi",
    rarity: "rare",
    oracleText:
        "Ninjutsu {2}{U}{B} ({2}{U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nWhenever this creature deals combat damage to a player, that player exiles the top two cards of their library. Until end of turn, you may play those cards without paying their mana costs.",
    manaCost: { X: 3, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Ninja"],
    power: 5,
    toughness: 4,
    // CR 702.49a — the keyword ability, usable only from hand.
    activatedAbilities: [ninjutsuAbility({ X: 2, U: 1, B: 1 })],
    triggeredAbilities: [
        {
            ...damageDealtTrigger({
                id: "fallen-shinobi-combat-damage",
                oracleText:
                    "Whenever this creature deals combat damage to a player, that player exiles the top two cards of their library. Until end of turn, you may play those cards without paying their mana costs.",
                source: "self",
                target: { kind: "player", player: { relation: "any" } },
                isCombat: true,
                resolve: (ctx, _event, damage) => {
                    if (damage.target.type !== "player") return;
                    const damagedPlayerId = damage.target.id;
                    // CR 608.2b — "the top TWO cards" takes as many as are
                    // there; a one-card library exiles one, an empty one none.
                    const top = ctx.peekLibraryTop(damagedPlayerId, 2);
                    for (const cardId of top) {
                        // CR 406.3 — exiled hidden from the card's own owner's
                        // opponents' view but known to this card's controller,
                        // who is about to play it (the Robber of the Rich /
                        // Ragavan precedent).
                        ctx.exileFaceDown(
                            damagedPlayerId,
                            cardId,
                            "library",
                            ctx.controller
                        );
                        // CR 601.3 / 305.9 / 118.9 — the cross-player grant:
                        // the card stays owned by (and exiled in) the DAMAGED
                        // player's zone (CR 400.7) while THIS card's controller
                        // may play it until end of turn, paying nothing.
                        ctx.grantCastFromExile(
                            cardId,
                            ctx.controller,
                            damagedPlayerId,
                            "this-turn",
                            {
                                withoutPayingManaCost: true,
                                includesLand: true,
                            }
                        );
                    }
                },
            }),
            // aiEffects (PRD #1423) — the shadow script for the closure above.
            // Two impulse-drawn cards, valued through the same
            // `CARD_SELECTION_VALUE` lever `lookDistribute`/`digMatchingToHand`
            // use for "look at N, keep one" (`gre/ai/opValuers.ts`), which is
            // this codebase's own stand-in for exile-and-may-play upside — the
            // identical approximation Ragavan's shadow script makes.
            aiEffects: [{ op: "draw", player: "controller", count: 2 }],
        },
    ],
};

// Wrenn and Six — {R}{G} Legendary Planeswalker — Wrenn, loyalty 3 (MH1,
// issue #2358). All three loyalty abilities use the shipped loyalty framework
// (ADR 0058, #700):
//   +1: "Return up to one target land card from your graveyard to your hand."
//       — `count: {min:0,max:1}` is the genuinely optional "up to one" target
//       (CR 601.2c; an empty announced set = decline), scoped to the
//       controller's own graveyard by `zone` + `controller` (Reya Dawnbringer
//       idiom), then a single `moveZone` to hand.
//   -1: "Wrenn and Six deals 1 damage to any target." — "any target" is
//       CR 115.4 (creature, player, or battle/planeswalker).
//   -7: emblem "Instant and sorcery cards in your graveyard have retrace."
//       — the emblem Op plus WRENN_AND_SIX_EMBLEM_ID, whose grant is the SECOND
//       producer of a retrace grant (`convex/gre/retrace.ts`): an emblem is not
//       a permanent (CR 114.1), so the battlefield sweep cannot see it.
//
// The card is the only exposure of Retrace (CR 702.81) in the pool: no card
// prints the keyword yet, and the emblem's grant is what makes an instant or
// sorcery in the graveyard castable for its printed cost plus a discarded land.
export const wrennAndSix: CardDefinition = {
    id: "4a706ecf-3277-40e3-871c-4ba4ead16e20",
    name: "Wrenn and Six",
    rarity: "mythic",
    oracleText:
        '+1: Return up to one target land card from your graveyard to your hand.\n−1: Wrenn and Six deals 1 damage to any target.\n−7: You get an emblem with "Instant and sorcery cards in your graveyard have retrace."',
    manaCost: { R: 1, G: 1 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Wrenn"],
    loyalty: 3,
    activatedAbilities: [
        {
            id: "wrenn-and-six-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Return up to one target land card from your graveyard to your hand.",
            // CR 601.2c — "up to one target": `{min:0,max:1}` lets the
            // controller announce zero targets (decline) without the ability
            // becoming illegal. `zone: "graveyard"` + `controller: "you"` is
            // "from YOUR graveyard".
            targetRequirement: {
                type: "Land",
                count: { min: 0, max: 1 },
                zone: "graveyard",
                controller: "you",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "wrenn-and-six-minus1",
            cost: { loyalty: -1 },
            useStack: true,
            oracleText: "−1: Wrenn and Six deals 1 damage to any target.",
            // CR 115.4 — "any target".
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
        {
            id: "wrenn-and-six-minus7",
            cost: { loyalty: -7 },
            useStack: true,
            oracleText:
                '−7: You get an emblem with "Instant and sorcery cards in your graveyard have retrace."',
            effects: [{ op: "emblem", emblem: WRENN_AND_SIX_EMBLEM_ID }],
        },
    ],
};
