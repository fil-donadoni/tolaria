// eve — multicolor cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Figure of Destiny — {R/W} Creature — Kithkin, 1/1 (Vintage Cube, issue
// #1749). "{R/W}: This creature becomes a Kithkin Spirit with base power and
// toughness 2/2. {R/W}{R/W}{R/W}: If this creature is a Spirit, it becomes a
// Kithkin Spirit Warrior with base power and toughness 4/4.
// {R/W}{R/W}{R/W}{R/W}{R/W}{R/W}: If this creature is a Warrior, it becomes a
// Kithkin Spirit Warrior Avatar with base power and toughness 8/8, flying, and
// first strike."
//
// A GOLD card by colour identity (CR 202.2 — a guild-hybrid pip is BOTH its
// colours), hence `multicolor.ts` and not `red.ts`/`white.ts`.
//
// Two engine capabilities this card is the reference shape for:
//
//  1. GUILD-HYBRID pips payable with MANA (issues #1738/#1739, PRD #1736) —
//     both the printed cost and all three activation costs are pure `{R/W}`,
//     so each pip is paid by a Mountain OR a Plains. Before that slice
//     `ManaCost.hybrid` was declaration-only and every pip was silently FREE.
//  2. The INDEFINITE form of `setSubtype` / `setBasePT` / `grantAbility`
//     (issue #1746, CR 611.2b) — a continuous effect from a resolving ability
//     with no stated duration lasts indefinitely, which is what "becomes a
//     Kithkin Spirit" means: it holds across turns until the permanent leaves
//     the battlefield (CR 400.7, undone by `resetBattlefieldTransientState`).
//
// Each stage REPLACES the creature types rather than adding to them (CR 205.1b
// — "becomes a Kithkin Spirit Warrior" states the full type line), so the Op is
// `setSubtype` (replace), never `addSubtype` (additive). Every line re-states
// the earlier stages' types, so the chain reads as accumulation even though
// each step is a replacement.
//
// The stage gates ("If this creature is a Spirit") are RESOLUTION-time checks,
// not activation restrictions (CR 602.2 — the ability may always be activated,
// it simply does nothing if the condition is false), so they are an `if`
// predicate inside the script: `objectMatchesFilter` (issue #1747), the
// live-object predicate that reads the subtype an EARLIER activation granted.
export const figureOfDestiny: CardDefinition = {
    id: "0da69523-cece-425a-b08a-fb27fac29374",
    rarity: "rare",
    name: "Figure of Destiny",
    oracleText:
        "{R/W}: This creature becomes a Kithkin Spirit with base power and toughness 2/2.\n{R/W}{R/W}{R/W}: If this creature is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4.\n{R/W}{R/W}{R/W}{R/W}{R/W}{R/W}: If this creature is a Warrior, it becomes a Kithkin Spirit Warrior Avatar with base power and toughness 8/8, flying, and first strike.",
    manaCost: { hybrid: [["R", "W"]] },
    types: ["Creature"],
    subtypes: ["Kithkin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "figure-of-destiny-spirit",
            oracleText:
                "{R/W}: This creature becomes a Kithkin Spirit with base power and toughness 2/2.",
            cost: { mana: { hybrid: [["R", "W"]] } },
            useStack: true,
            // Unconditional first stage — no `if` gate. No `duration` on either
            // Op: CR 611.2b, the change is indefinite.
            effects: [
                {
                    op: "setSubtype",
                    target: { ref: "$source" },
                    subtypes: ["Kithkin", "Spirit"],
                },
                {
                    op: "setBasePT",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                },
            ],
        },
        {
            id: "figure-of-destiny-warrior",
            oracleText:
                "{R/W}{R/W}{R/W}: If this creature is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4.",
            cost: {
                mana: {
                    hybrid: [
                        ["R", "W"],
                        ["R", "W"],
                        ["R", "W"],
                    ],
                },
            },
            useStack: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { subtype: "Spirit" },
                    },
                    then: [
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: ["Kithkin", "Spirit", "Warrior"],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 4,
                            toughness: 4,
                        },
                    ],
                },
            ],
        },
        {
            id: "figure-of-destiny-avatar",
            oracleText:
                "{R/W}{R/W}{R/W}{R/W}{R/W}{R/W}: If this creature is a Warrior, it becomes a Kithkin Spirit Warrior Avatar with base power and toughness 8/8, flying, and first strike.",
            cost: {
                mana: {
                    hybrid: [
                        ["R", "W"],
                        ["R", "W"],
                        ["R", "W"],
                        ["R", "W"],
                        ["R", "W"],
                        ["R", "W"],
                    ],
                },
            },
            useStack: true,
            effects: [
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { ref: "$source" },
                        filter: { subtype: "Warrior" },
                    },
                    then: [
                        {
                            op: "setSubtype",
                            target: { ref: "$source" },
                            subtypes: [
                                "Kithkin",
                                "Spirit",
                                "Warrior",
                                "Avatar",
                            ],
                        },
                        {
                            op: "setBasePT",
                            target: { ref: "$source" },
                            power: 8,
                            toughness: 8,
                        },
                        // CR 611.2b — granted with no `duration`: the keywords
                        // stay for as long as the permanent does.
                        {
                            op: "grantAbility",
                            target: { ref: "$source" },
                            ability: "flying",
                        },
                        {
                            op: "grantAbility",
                            target: { ref: "$source" },
                            ability: "first strike",
                        },
                    ],
                },
            ],
        },
    ],
};
