// MH3 — green cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { ELDRAZI_SPAWN_TOKEN, GREEN_INSECT_TOKEN } from "../../sharedTokens";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";
import { eternalizeAbility } from "../../abilities/eternalize";

/** CR 111 — Fanatic of Rhonas's own printed eternalize token (tmh3 #15, a 4/4
 *  black Token Creature — Zombie Snake Druid). Pinned by hand: the catalogue's
 *  token-art guard (`tokenPrintLookup.test.ts`) only walks `createToken`
 *  specs, and an eternalize token is created by `createTokenCopy`, which has no
 *  static spec to inspect. */
const FANATIC_OF_RHONAS_TOKEN_PRINT_ID = "6ef58164-4155-4e5b-8c16-f16f2ab65baa";

// Fanatic of Rhonas — {1}{G} Creature — Snake Druid, 1/4.
// "{T}: Add {G}. Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you
// control a creature with power 4 or greater." (Ferocious ability word —
// engine infra, no registry row.)
// "Eternalize {2}{G}{G}" (CR 702.129) is the shared `eternalizeAbility`
// factory (`convex/cards/abilities/eternalize.ts`): a graveyard-source,
// sorcery-speed activated ability whose cost exiles this card and whose script
// creates the CR 707.2 token copy — a 4/4 black Zombie Snake Druid with no mana
// cost, rendered as this card's own printed eternalize token (tmh3 #15).
export const fanaticOfRhonas: CardDefinition = {
    id: "1f9fb33a-3b39-4aff-93b8-aedafe0ea694",
    rarity: "rare",
    name: "Fanatic of Rhonas",
    oracleText:
        "{T}: Add {G}.\nFerocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.\nEternalize {2}{G}{G} ({2}{G}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Druid with no mana cost. Eternalize only as a sorcery.)",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Snake", "Druid"],
    power: 1,
    toughness: 4,
    activatedAbilities: [
        {
            id: "tap-for-g",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
        },
        {
            id: "ferocious-tap-for-gggg",
            oracleText:
                "Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 4 },
            canActivate(source: PermanentView, stv: TriggerStateView): boolean {
                const controllerId = source.controllerId;
                for (const player of stv.players) {
                    if (player.id !== controllerId) continue;
                    for (const p of player.battlefield) {
                        if (
                            p.types.includes("Creature") &&
                            (p.power ?? 0) >= 4
                        ) {
                            return true;
                        }
                    }
                }
                return false;
            },
        },
        // CR 702.129 — Eternalize {2}{G}{G}. The reminder text's "Zombie Snake
        // Druid" body is rendered from this card's own printed subtypes; the
        // real subtype union is computed by the copy effect at resolution.
        eternalizeAbility(
            { X: 2, G: 2 },
            ["Snake", "Druid"],
            FANATIC_OF_RHONAS_TOKEN_PRINT_ID
        ),
    ],
};

// Malevolent Rumble — {1}{G} Sorcery (Cube FREE wave 3, issue #1531/#1525).
// "Reveal the top four cards of your library. You may put a permanent card
// from among them into your hand. Put the rest into your graveyard. Create a
// 0/1 colorless Eldrazi Spawn creature token with 'Sacrifice this token: Add
// {C}.'" (CR 701.20a reveal, CR 401.4 dig, CR 707.2 token creation.) Fully
// free — a `lookDistribute` Op (issue #984/#1101) with `reveal: "window"`
// (Reviving Vapors precedent) and `filter: { type: PERMANENT_TYPES }` (any of
// the six permanent card types, CR 300.1) expresses "a permanent card"
// exactly; `destination: "graveyard"` sends the rest there (Reviving Vapors'
// own `graveyard` leg). The Eldrazi Spawn is the shared
// `ELDRAZI_SPAWN_TOKEN` spec (`sharedTokens.ts`), pinned to its own printed
// Scryfall art.
export const malevolentRumble: CardDefinition = {
    id: "a178cfe8-f9fa-4255-88d0-54a0bed079f5",
    rarity: "common",
    name: "Malevolent Rumble",
    oracleText:
        'Reveal the top four cards of your library. You may put a permanent card from among them into your hand. Put the rest into your graveyard. Create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."',
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: 4,
            take: 1,
            optional: true,
            filter: { type: [...PERMANENT_TYPES] },
            destination: "graveyard",
            reveal: "window",
        },
        {
            op: "createToken",
            token: ELDRAZI_SPAWN_TOKEN,
            controller: "controller",
        },
    ],
};

// Springheart Nantuko — {1}{G} Enchantment Creature — Insect Monk, 1/1 (issue
// #2388, the FIRST Bestow card in the catalogue). "Bestow {1}{G} (If you cast
// this card for its bestow cost, it's an Aura spell with enchant creature. It
// becomes a creature again if it's not attached to a creature.) / Enchanted
// creature gets +1/+1. / Landfall — Whenever a land you control enters, you
// may pay {1}{G} if this permanent is attached to a creature you control. If
// you do, create a token that's a copy of that creature. If you didn't create
// a token this way, create a 1/1 green Insect creature token."
//
// THREE clauses, three shipped mechanisms and no new Op:
//
//  1. Bestow (CR 702.103) is engine/cost infra, not a card ability: the
//     `bestow` field below is the alternative COST (CR 702.103a says casting
//     bestowed "follows the rules for paying alternative costs"), and
//     `convex/gre/bestow.ts` owns the characteristic change (CR 702.103b), the
//     illegal-target-becomes-a-creature-spell rule (702.103e / 608.3b) and the
//     unattached-reverts-in-place rule (702.103f, the documented exception to
//     the CR 704.5m Aura SBA). No per-card code.
//  2. "Enchanted creature gets +1/+1" is the ordinary Aura `pt-buff`
//     `staticEffect` keyed on `attachedTo` (CR 613 layer 7c) — the SAME shape
//     Unstable Mutation (`arn/blue.ts`) uses. It needs no bestow-awareness at
//     all: `attachedTo` is only ever set on this permanent by a bestowed cast,
//     so the buff switches itself off the instant CR 702.103f reverts it.
//  3. The landfall half is the shared `landfallTrigger` factory (CR 603.6a /
//     109.5) over a fully DSL body. "That creature" is `{ ref: "$host" }`, the
//     implicit attachment-host binding every Aura/Equipment ability already
//     gets (CR 303.4m); "attached to a creature YOU CONTROL" is
//     `objectMatchesFilter` + its `controlledBy` scope. An unattached source
//     seeds no `$host`, so the predicate reads false and the else-branch runs
//     — which is exactly the printed behaviour (no payment is offered, and the
//     plain Insect token is created).
export const springheartNantuko: CardDefinition = {
    id: "54a3ea87-005e-4985-b2a5-21711d0b71c0",
    rarity: "rare",
    name: "Springheart Nantuko",
    oracleText:
        "Bestow {1}{G} (If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached to a creature.)\nEnchanted creature gets +1/+1.\nLandfall — Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Insect", "Monk"],
    power: 1,
    toughness: 1,
    // CR 702.103a — "Bestow {1}{G}" = "you pay {1}{G} rather than its mana
    // cost". Here the two happen to be equal, which is the printed card; the
    // engine reads them independently regardless.
    bestow: {
        id: "bestow",
        description: "Bestow {1}{G} (cast as an Aura — enchant creature)",
        mana: { X: 1, G: 1 },
    },
    staticEffects: [
        {
            // CR 613 layer 7c / 303.4m — "enchanted creature", i.e. whatever
            // this permanent is attached to.
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 1,
            toughness: 1,
        },
    ],
    triggeredAbilities: [
        landfallTrigger({
            id: "springheart-nantuko-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token.",
            effects: [
                {
                    op: "if",
                    // CR 109.5 — the may-pay is offered ONLY while this
                    // permanent is attached to a creature its controller
                    // controls. `$host` is seeded from the live `attachedTo`
                    // as the trigger begins resolving (CR 608.2), so an
                    // unattached Nantuko — or one bestowed onto an opponent's
                    // creature, or whose host changed control — falls to the
                    // else-branch with no prompt at all.
                    predicate: {
                        objectMatchesFilter: { ref: "$host" },
                        filter: { type: "Creature" },
                        controlledBy: "controller",
                    },
                    then: [
                        {
                            op: "mayPay",
                            player: "controller",
                            cost: { mana: { X: 1, G: 1 } },
                            prompt: "Pay {1}{G} to copy the enchanted creature?",
                            bind: "$paid",
                        },
                        {
                            op: "if",
                            predicate: { binding: "$paid" },
                            then: [
                                {
                                    // CR 707.2 — "a token that's a copy of
                                    // that creature", i.e. of the host.
                                    op: "createTokenCopy",
                                    source: { ref: "$host" },
                                    controller: "controller",
                                },
                            ],
                            // "If you DIDN'T create a token this way" — the
                            // declined branch still makes the Insect.
                            else: [
                                {
                                    op: "createToken",
                                    token: GREEN_INSECT_TOKEN,
                                    controller: "controller",
                                },
                            ],
                        },
                    ],
                    else: [
                        {
                            op: "createToken",
                            token: GREEN_INSECT_TOKEN,
                            controller: "controller",
                        },
                    ],
                },
            ],
        }),
    ],
};
