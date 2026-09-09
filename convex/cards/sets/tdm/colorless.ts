// TDM — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, EffectOp, TargetRequirement } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";

// Ugin, Eye of the Storms — {7} Legendary Planeswalker — Ugin, loyalty 7
// (TDM, issue #3229).
// "When you cast this spell, exile up to one target permanent that's one or
//  more colors.
//  Whenever you cast a colorless spell, exile up to one target permanent
//  that's one or more colors.
//  +2: You gain 3 life and draw a card.
//  0: Add {C}{C}{C}.
//  −11: Search your library for any number of colorless nonland cards, exile
//     them, then shuffle. Until end of turn, you may cast those cards without
//     paying their mana costs."
//
// TWO SEPARATE TRIGGERS, and the duplication is the printed card's own, not an
// authoring slip. A cast-WATCHING ability functions only from the battlefield
// (CR 113.6), and Ugin is not on the battlefield while his own spell is on the
// stack — so the second line can never see the first cast. The first line is the
// one that does, and it functions from the STACK because its trigger condition
// cannot trigger from the battlefield at all (CR 113.6k): that is the
// `functionsFromStack` marker `spellCastTrigger` stamps on `scope: "self"`,
// collected by `collectSelfCastTriggers` (`gre/state.ts`) at the single cast
// choke point so it lands ABOVE Ugin himself and resolves FIRST. Ugin is
// himself a colorless spell, and the FAIL-CLOSED design of that marker is what
// keeps the second line from double-firing on him: a `scope: "you"` trigger is
// never scanned on the stack.
//
// THE FIRST TARGETED CAST TRIGGER in the catalogue (Emrakul's extra turn and
// Mana Vortex's counter-unless are both untargeted), which is why this card also
// carries two engine-side pieces: `SpellCastTriggerArgs.targetRequirement`
// (forwarded verbatim, exactly as the entered / attacks / phase factories
// already do) and the CR 603.3d target sweep in `collectSelfCastTriggers` — a
// self-cast trigger bypasses `placeTriggersOnStack`, which is where every other
// producer's sweep lives, so without it the announced slot was never filled and
// the trigger resolved doing nothing.
//
// "PERMANENT THAT'S ONE OR MORE COLORS" is `type: [...PERMANENT_TYPES]` (any
// permanent) plus `colorFilterAny` over all five colours — CR 105.2's OR
// semantics, i.e. "is coloured". A colourless permanent has no colour to match
// (CR 105.2c) and is therefore never legal; a player is never legal either
// (`colorFilterAny` drops player targets by construction). "Up to one" is
// `count: { min: 0, max: 1 }`, so with no coloured permanent on the board the
// trigger stays on the stack and exiles nothing (CR 603.3d) rather than being
// removed.
//
// "COLORLESS SPELL" is `excludeColors` on the shared `SpellFilter` — the
// negative of `colors`, added here as the symmetric twin of the existing
// `excludeTypes` (ADR 0045 "generalize, don't add"). Colourless is the ABSENCE
// of colour (CR 105.2c), never a sixth colour, so the filter is "has none of
// W/U/B/R/G", not "has colour C".
//
// One engine narrowing rides on that. `SpellCastEvent.spellColors` is derived
// from the MANA COST alone (`emitSpellCastEvent`, `gre/state.ts`), and colour
// indicators (CR 202.2b) are not modelled on `CardDefinition` — out of scope here,
// the defect is in the three Kobold definitions rather than in this trigger (see
// `cards/colors.ts` and
// docs/findings/3229-colour-indicators-are-not-modelled-on-carddefinition.md).
// Crimson Kobolds / Crookshank Kobolds / Kobolds of Kher Keep
// (`sets/leg/colorless.ts`) are printed RED with an empty mana cost, so this
// trigger fires on them where paper says it must not. The reverse direction is
// safe: no devoid card ships.
//
// +2 / 0 are the plain shipped Op shapes (`gainLife` + `draw`; `addMana` with
// `{ C: 3 }` — unrestricted colourless mana, CR 106.1, not a Powerstone's
// spend-restricted mana).
//
// −11 uses the LINKED-EXILE route, not the bare-picks one. `moveZone`'s
// `linkToSource` (issue #1947, Skyship Weatherlight's own "search for any
// number… exile them") stamps `exiledBySourceId` = Ugin on EVERY exiled card
// (CR 607 linked abilities), and `grantCastFromExile`'s `{ exiledWithSource:
// true }` selector reads that whole pile back through
// `getCardsExiledWith(ctx.sourceInstanceId)`. The bare-picks branch grants the
// FIRST pick only, which would silently drop every card after the first — the
// difference matters precisely because this search is "any number".
// `window: "this-turn"` is the printed "until end of turn"; the cast is free
// (CR 118.9 — the rule that quotes "without paying its mana cost" verbatim).
const UGIN_COLORED_PERMANENT: TargetRequirement = {
    type: [...PERMANENT_TYPES],
    count: { min: 0, max: 1 },
    // CR 105.2 — OR across all five colours is exactly "is one or more colors".
    colorFilterAny: ["W", "U", "B", "R", "G"],
};

// CR 608.2b — an unfilled "up to one" slot resolves to no object and the Op
// skips, so the same one-Op body serves both triggers.
const UGIN_EXILE_COLORED: EffectOp[] = [{ op: "exile", target: { target: 0 } }];

// compiler-gap: "When you cast this spell, exile up to one target permanent that's one or more colors." (#2693)
// compiler-gap: "Whenever you cast a colorless spell, exile up to one target permanent that's one or more colors." (#2693)
// compiler-gap: "+2: You gain 3 life and draw a card." (#2693)
// compiler-gap: "0: Add {C}{C}{C}." (#2693)
// compiler-gap: "-11: Search your library for any number of colorless nonland cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs." (#2693)
export const uginEyeOfTheStorms: CardDefinition = {
    id: "64a5d494-efa1-446b-bebe-2ad36e154376",
    name: "Ugin, Eye of the Storms",
    rarity: "mythic",
    oracleText:
        "When you cast this spell, exile up to one target permanent that's one or more colors.\nWhenever you cast a colorless spell, exile up to one target permanent that's one or more colors.\n+2: You gain 3 life and draw a card.\n0: Add {C}{C}{C}.\n−11: Search your library for any number of colorless nonland cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs.",
    manaCost: { X: 7 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    subtypes: ["Ugin"],
    loyalty: 7,
    triggeredAbilities: [
        spellCastTrigger({
            id: "ugin-eye-of-the-storms-cast-self",
            oracleText:
                "When you cast this spell, exile up to one target permanent that's one or more colors.",
            // CR 113.6k — functions from the stack, where the spell is.
            scope: "self",
            targetRequirement: UGIN_COLORED_PERMANENT,
            effects: UGIN_EXILE_COLORED,
        }),
        spellCastTrigger({
            id: "ugin-eye-of-the-storms-cast-colorless",
            oracleText:
                "Whenever you cast a colorless spell, exile up to one target permanent that's one or more colors.",
            scope: "you",
            // CR 105.2c — colourless is the absence of colour, so the filter is
            // "none of the five", never a colour of its own.
            filter: { excludeColors: ["W", "U", "B", "R", "G"] },
            targetRequirement: UGIN_COLORED_PERMANENT,
            effects: UGIN_EXILE_COLORED,
        }),
    ],
    activatedAbilities: [
        {
            id: "ugin-eye-of-the-storms-plus2",
            cost: { loyalty: 2 },
            useStack: true,
            oracleText: "+2: You gain 3 life and draw a card.",
            effects: [
                { op: "gainLife", player: "controller", amount: 3 },
                { op: "draw", player: "controller", count: 1 },
            ],
        },
        {
            id: "ugin-eye-of-the-storms-zero",
            cost: { loyalty: 0 },
            useStack: true,
            oracleText: "0: Add {C}{C}{C}.",
            // CR 605.1a — NOT a mana ability: it is a loyalty ability, which is
            // never a mana ability (CR 606.2), so it uses the stack.
            effects: [{ op: "addMana", mana: { C: 3 }, player: "controller" }],
        },
        {
            id: "ugin-eye-of-the-storms-minus11",
            cost: { loyalty: -11 },
            useStack: true,
            oracleText:
                "−11: Search your library for any number of colorless nonland cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs.",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    // CR 105.2c + CR 305.1 — colourless AND nonland.
                    filter: {
                        excludeColor: ["W", "U", "B", "R", "G"],
                        excludeType: "Land",
                    },
                    count: { min: 0, max: Number.MAX_SAFE_INTEGER },
                    prompt: "Search your library for any number of colorless nonland cards to exile.",
                    bind: "$found",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$found" },
                    player: "controller",
                    from: "library",
                    to: "exile",
                    // CR 607 — link the whole pile to Ugin so the grant below
                    // reaches EVERY exiled card, not just the first pick.
                    linkToSource: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
                {
                    op: "grantCastFromExile",
                    card: { exiledWithSource: true },
                    player: "controller",
                    window: "this-turn",
                    withoutPayingManaCost: true,
                },
            ],
        },
    ],
};
