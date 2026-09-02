// war — multicolor cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// TODO(issue #679 stub — still blocked, but on a NARROWER gap than before.
// The categorized shared-window half of #1364 HAS since shipped as the
// `revealAndCategorize` Op (reveal a fixed top-N window once, then at most one
// card per category out of that same revealed set, each card claimable by only
// one category — Atraxa, Grand Unifier, one/multicolor.ts, now implemented on
// it). What remains for Niv-Mizzet is the CATEGORY PREDICATE: its ten
// categories are exact colour PAIRS ("a card that's EXACTLY those colors"),
// and `EffectCardFilter.color` is only an OR-any-of-these-colours match with
// no exact-colours mode — a Bant card would wrongly satisfy the WU category.
// `excludeColor` cannot fix it either (excluding the other three colours does
// not require BOTH of W and U to be present). Needs an exact-colours filter
// field before the card can ship; stop-and-issue per gre-development.md.
// tracked-by: #1364.
// export const nivMizzetReborn: CardDefinition = {
//     id: "56a2609d-b535-400b-81d9-72989a33c70f",
//     name: "Niv-Mizzet Reborn",
//     rarity: "mythic",
//     manaCost: { W: 1, U: 1, B: 1, R: 1, G: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Dragon", "Avatar"],
//     power: 6,
//     toughness: 6,
// };

// ─────────────────────────────────────────────────────────────────────────
// Teferi, Time Raveler — {1}{W}{U} Legendary Planeswalker — Teferi, starting
// loyalty 4 (CR 306.5b). Vintage Cube (planeswalker umbrella #1222). Three
// clauses, all on the per-player casting-timing subsystem built for this card:
//   • STATIC — "Each opponent can cast spells only any time they could cast a
//     sorcery." A `cast-timing-lock` StaticEffect (CR 601.3a): the timing
//     analogue of Brand of Ill Omen's `cast-restriction` (a class forbid).
//     `locks` returns true for every player who is NOT this permanent's
//     controller, so the shared cast gate (`isCastTimingSorcerySpeedLocked`,
//     castRestrictions.ts, read by `getLegalActions`'s `castTimingBaseLegal`)
//     forces each opponent to sorcery timing for EVERY spell — instants and
//     flash spells included. Read-time only; auto-reverts when Teferi leaves.
//   • +1 — "Until your next turn, you may cast sorcery spells as though they
//     had flash." A `grantCastTiming` Op (CR 601.3b) granting the controller a
//     flash-timing permission scoped to `cardTypes: ["Sorcery"]`, cleared at
//     the start of the controller's next turn (advanceTurn) — the "until your
//     next turn" boundary. A no-target loyalty ability.
//   • −3 — "Return up to one target artifact, creature, or enchantment to its
//     owner's hand. Draw a card." A `moveZone`-to-hand of the up-to-one
//     announced target (CR 400.7; `count { min: 0, max: 1 }` = "up to one", a
//     no-op when none is chosen/legal, CR 608.2b) then `draw` 1.
export const teferiTimeRaveler: CardDefinition = {
    id: "5cb76266-ae50-4bbc-8f96-d98f309b02d3",
    name: "Teferi, Time Raveler",
    rarity: "rare",
    manaCost: { generic: 1, W: 1, U: 1 },
    types: ["Planeswalker"],
    subtypes: ["Teferi"],
    supertypes: ["Legendary"],
    loyalty: 4,
    oracleText:
        "Each opponent can cast spells only any time they could cast a sorcery.\n+1: Until your next turn, you may cast sorcery spells as though they had flash.\n−3: Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card.",
    // CR 601.3a — "Each OPPONENT can cast spells only any time they could cast a
    // sorcery": a battlefield-scanned casting-TIMING lock on every player who is
    // not Teferi's controller (see `castTimingBaseLegal`, gre/rules.ts).
    staticEffects: [
        {
            kind: "cast-timing-lock",
            id: "teferi-time-raveler-opponents-sorcery-speed",
            locks: (caster, source) => caster !== source.controllerId,
            oracleText:
                "Each opponent can cast spells only any time they could cast a sorcery.",
        },
    ],
    activatedAbilities: [
        {
            id: "teferi-time-raveler-plus1",
            // CR 606.2 / 606.5 — loyalty ability; `+1` adds one counter.
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Until your next turn, you may cast sorcery spells as though they had flash.",
            // CR 601.3b — grant the controller flash-timing for Sorcery spells
            // until their next turn (grantCastTiming Op).
            effects: [
                {
                    op: "grantCastTiming",
                    player: "controller",
                    cardTypes: ["Sorcery"],
                },
            ],
        },
        {
            id: "teferi-time-raveler-minus3",
            // CR 606.2 / 606.5 — `-3` removes three counters.
            cost: { loyalty: -3 },
            useStack: true,
            oracleText:
                "−3: Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card.",
            // CR 115.1 / 603.3d — "up to one target artifact, creature, or
            // enchantment": a real target chosen at announcement (min 0 = "up
            // to one"); any controller's permanent is eligible (no controller
            // restriction in the text).
            targetRequirement: {
                type: ["Artifact", "Creature", "Enchantment"],
                count: { min: 0, max: 1 },
            },
            effects: [
                // CR 400.7 — bounce the announced target to its owner's hand; a
                // no-op when none was chosen/legal (CR 608.2b).
                { op: "moveZone", target: { target: 0 }, to: "hand" },
                // CR 121.1 — then draw a card (unconditional).
                { op: "draw", player: "controller", count: 1 },
            ],
        },
    ],
};
