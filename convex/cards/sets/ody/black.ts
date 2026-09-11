// ody — black cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { ZOMBIE_TOKEN } from "../../sharedTokens";

// Innocent Blood — "Each player sacrifices a creature of their choice."
// (CR 701.21 sacrifice.) The first DSL card composing a `choice` Op INSIDE a
// forEach construct (ADR 0045, issue #807): the players set iterates in
// APNAP order (CR 101.4 — active player decides first, then each other
// player in turn order); each iteration suspends on a `sacrifice-permanents`
// Pending Choice for the current player (`$each`) and resumes to sacrifice
// the pick. A player with no creatures is skipped entirely (CR 608.2b — the
// choice clamps to zero candidates, so neither the prompt nor the sacrifice
// happens). `simultaneous: true` (issue #1872) is what makes the timing right:
// the interpreter collects EVERY player's pick first and only then applies the
// sacrifices, so a later chooser decides against the board the earlier
// choosers saw — CR 101.4's "Then the actions happen simultaneously", whose
// worked example in the rules text is this card's own line.
export const innocentBlood: CardDefinition = {
    id: "d26af8f6-df64-4027-880c-f2fae2d8103f",
    name: "Innocent Blood",
    rarity: "common",
    oracleText: "Each player sacrifices a creature of their choice.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            // CR 101.4 — "Then the actions happen simultaneously." The rule's
            // own example IS this card: every player chooses in APNAP order,
            // then all chosen creatures are sacrificed together.
            simultaneous: true,
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$each" },
                    zone: "battlefield",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Innocent Blood: choose a creature to sacrifice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
    ],
};

// Entomb — {B} Instant. "Search your library for a card, put that card into
// your graveyard, then shuffle." (CR 701.23 search / 400.7 / 701.24 shuffle.) An unrestricted
// tutor straight to the graveyard — `moveZone`'s `to: "graveyard"` branch,
// issue #677.
export const entomb: CardDefinition = {
    id: "f60a2091-fb97-4f04-911b-fce9b6351044",
    name: "Entomb",
    rarity: "rare",
    manaCost: { B: 1 },
    types: ["Instant"],
    oracleText:
        "Search your library for a card, put that card into your graveyard, then shuffle.",
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
            bind: "$picked",
        },
        {
            op: "moveZone",
            cards: { ref: "$picked" },
            player: "controller",
            from: "library",
            to: "graveyard",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};

// Haunting Echoes — {3}{B}{B} Sorcery. "Exile all cards from target player's
// graveyard other than basic land cards. For each card exiled this way, search
// that player's library for all cards with the same name as that card and
// exile them. Then that player shuffles."
//
// One `forEach { set: "graveyard" }` (CR 404) over the target's graveyard, its
// member set frozen at construct entry (CR 608.2h — "the answer is determined
// only once, when the effect is applied") — so the cards the library
// sweep is driven by are exactly the ones the oracle calls "exiled this way",
// and nothing that reaches the graveyard mid-resolution joins them. The
// "other than basic land cards" restriction (CR 205.4a) is the OR-clause
// `any: [{ excludeType: "Land" }, { excludeSupertype: "Basic" }]` — a card
// matches unless it is BOTH a land AND basic, which is the negation an
// AND-of-fields filter cannot spell on its own.
//
// Both halves of the body are name-keyed filter sweeps driven by
// `{ ref: "$each.name" }` — the CR 608.2h last-known name off the iteration
// snapshot, which is what makes the library half readable AFTER the graveyard
// half moved that card out. Per-member interleaving is observationally
// identical to the oracle's two sentences: the member set is already frozen
// (CR 608.2h), the graveyard sweep can only ever reach frozen members, and the
// library sweep only ever moves library cards.
//
// Both legs key on the member's NAME rather than its id, because `moveZone`'s
// general-ref graveyard recovery is gated on `to: "battlefield"` — a
// `{ target: { ref: "$each" }, to: "exile" }` silently no-ops. One consequence
// worth naming: a graveyard card with no registry definition snapshots an
// EMPTY name, so the first sentence would leave it behind. Fail-closed and
// unreachable for a real deck (every card in one has a definition), and right
// for the second sentence either way (CR 201.2a — an object with no name
// shares a name with nothing).
//
// CR 701.23b — the searcher "isn't required to find some or all of those
// cards", and the rule's own worked example is Splinter, this card's near
// twin: the caster may find zero, one or two of the library copies. This card
// always finds every copy, a real deviation and not a free one. Out of scope
// here: exiling a dead card THINS the opponent's deck, so declining is
// sometimes correct and the prompt is genuinely owed.
//
// What blocks it is CR 701.23h: several search instructions before one shuffle
// are ONE search, and this card searches for the name of EVERY card it exiled.
// The CR-correct shape is therefore a single search whose candidate filter is
// a SET of names, and `EffectCardFilter.name` holds one literal or one ref.
// Lobotomy (`tmp/multicolor.ts`) searches for ONE name, which is why it can
// afford the explicit `search-library` prompt — and its own comment records
// why that prompt matters — and why this card cannot copy it. Recorded in
// docs/findings/2711-fromzones-sweep-unvalued-and-unsearched.md.
//
// compiler-gap: "Exile all cards from target player's graveyard other than basic land cards." (#2693)
// compiler-gap: "For each card exiled this way, search that player's library for all cards with the same name as that card and exile them." (#2693)
export const hauntingEchoes: CardDefinition = {
    id: "aca4c571-48b8-4150-93f8-4cb5c8e797c4", // ODY 142 (first printing)
    name: "Haunting Echoes",
    rarity: "rare",
    manaCost: { X: 3, B: 2 },
    types: ["Sorcery"],
    oracleText:
        "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: { target: 0 },
                // CR 205.4a — "other than basic land cards": NOT (Land AND
                // Basic), so a nonbasic land and a basic-supertyped nonland
                // both stay in the set.
                filter: {
                    any: [
                        { excludeType: "Land" },
                        { excludeSupertype: "Basic" },
                    ],
                },
            },
            effects: [
                // CR 400.7 / 201.2 — the graveyard half, mandatory: a public
                // zone, no search and no choice. Keyed by the member's own
                // name rather than its id, so two graveyard copies of one card
                // leave together on the first of their iterations and the
                // second finds nothing (CR 608.2b); the same
                // not-a-basic-land clause the member set was selected with
                // keeps a same-named basic out of reach.
                {
                    op: "moveZone",
                    player: { target: 0 },
                    fromZones: ["graveyard"],
                    filter: {
                        name: { ref: "$each.name" },
                        any: [
                            { excludeType: "Land" },
                            { excludeSupertype: "Basic" },
                        ],
                    },
                    to: "exile",
                },
                // CR 701.23a / 201.2 — "search that player's library for all
                // cards with the same name as that card and exile them".
                {
                    op: "moveZone",
                    player: { target: 0 },
                    fromZones: ["library"],
                    filter: { name: { ref: "$each.name" } },
                    to: "exile",
                },
            ],
        },
        // CR 701.24a — "Then that player shuffles." One shuffle at the end,
        // not one per member (CR 701.23h — repeated searches before a single
        // shuffle instruction are one search).
        { op: "libraryLook", action: "shuffle", player: { target: 0 } },
    ],
};

// Zombie Infestation — {1}{B} Enchantment. "Discard two cards: Create a 2/2
// black Zombie creature token." (CR 701.9a discard as a cost, CR 111.1
// token creation.) An ordinary stack-using activated ability on an
// enchantment: it adds no mana, so CR 605.1a's mana-ability exemption does
// not apply and it waits for priority. The empty filter constrains nothing
// ("two cards"), and the pair is paid at activation, never at resolution —
// so a responding removal spell does not refund the cards (CR 602.2b).
//
// compiler-gap: "Discard two cards: Create a 2/2 black Zombie creature token." (#2693)
export const zombieInfestation: CardDefinition = {
    id: "ccd5f98a-7ab5-44b3-850c-b50963dace66",
    rarity: "uncommon",
    name: "Zombie Infestation",
    oracleText: "Discard two cards: Create a 2/2 black Zombie creature token.",
    manaCost: { X: 1, B: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "zombie-infestation-tokens",
            oracleText:
                "Discard two cards: Create a 2/2 black Zombie creature token.",
            cost: { discardFilter: { filter: {}, count: 2 } },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    controller: "controller",
                    count: 1,
                    token: ZOMBIE_TOKEN,
                },
            ],
        },
    ],
};
