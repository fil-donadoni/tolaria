// lrw — green cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = first paper printing, LRW).

import type { CardDefinition } from "../../types";

// ─────────────────────────────────────────────────────────────────────────
// Planeswalker / loyalty framework tracer (issue #700, ADR 0058)
// ─────────────────────────────────────────────────────────────────────────
//
// Garruk Wildspeaker — {2}{G}{G} Legendary Planeswalker, starting loyalty 3
// (CR 306.5b). The framework issue's second tracer swaps Karn, Scion of Urza
// (whose three abilities each need a NOT-yet-built Op — library-top reveal +
// opponent-choice routing, a counter-tagged exile with a counter-filtered
// exile return, and a dynamic-P/T token) for this emblem-free planeswalker,
// whose three loyalty abilities (CR 606) reuse ONLY already-exercised Ops, per
// the issue's explicit "swap for a simpler emblem-free planeswalker" clause. No
// hand-written per-card test is required (per-Op regime, ADR 0045/0046); the
// loyalty FRAMEWORK has dedicated tests in `convex/gre/__tests__/loyalty.test.ts`.
//   • +1 — untap two target lands: two `tapUntap{action:"untap"}` Ops (the Icy
//     Manipulator untap shape, arn/colorless.ts) over a two-Land target group.
//   • −1 — create a 3/3 green Beast token: `createToken` with a plain static
//     P/T spec (the folded happy path, no `staticEffects`).
//   • −4 — creatures you control get +3/+3 and gain trample until end of turn:
//     forEach{permanents, controller:"controller", Creature} → pump + grant
//     trample, both until end of turn (CR 611.2a / 514.2 expiry).
export const garrukWildspeaker: CardDefinition = {
    id: "ca6f13a2-9243-4ce9-9f71-bed74355b781",
    name: "Garruk Wildspeaker",
    rarity: "rare",
    manaCost: { X: 2, G: 2 },
    types: ["Planeswalker"],
    subtypes: ["Garruk"],
    supertypes: ["Legendary"],
    loyalty: 3,
    oracleText:
        "+1: Untap two target lands.\n−1: Create a 3/3 green Beast creature token.\n−4: Creatures you control get +3/+3 and gain trample until end of turn.",
    activatedAbilities: [
        {
            id: "garruk-wildspeaker-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText: "+1: Untap two target lands.",
            targetRequirement: { type: "Land", count: 2 },
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                { op: "tapUntap", action: "untap", target: { target: 1 } },
            ],
        },
        {
            id: "garruk-wildspeaker-minus1",
            cost: { loyalty: -1 },
            useStack: true,
            oracleText: "−1: Create a 3/3 green Beast creature token.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Beast",
                        types: ["Creature"],
                        subtypes: ["Beast"],
                        power: 3,
                        toughness: 3,
                        colors: ["G"],
                    },
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "garruk-wildspeaker-minus4",
            cost: { loyalty: -4 },
            useStack: true,
            oracleText:
                "−4: Creatures you control get +3/+3 and gain trample until end of turn.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 3,
                            toughness: 3,
                            duration: { phase: "end-of-turn" },
                        },
                        {
                            op: "grantAbility",
                            ability: "trample",
                            target: { ref: "$each" },
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};
