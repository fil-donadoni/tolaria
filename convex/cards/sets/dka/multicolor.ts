// dka — multicolor cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types/loyalty are from Scryfall (id = DKA paper printing).

import type { CardDefinition } from "../../types";
import { SORIN_LORD_OF_INNISTRAD_EMBLEM_ID } from "../../emblems";

// ─────────────────────────────────────────────────────────────────────────
// Emblem subsystem tracer (issue #1221, follow-up to the loyalty framework
// #700 / ADR 0058)
// ─────────────────────────────────────────────────────────────────────────
//
// Sorin, Lord of Innistrad — {2}{W}{B} Legendary Planeswalker, starting
// loyalty 3 (CR 306.5b). Its −2 is the tracer for the emblem subsystem
// (CR 114): the new `emblem` Effect Script Op creates a command-zone emblem
// whose continuous static ability — "Creatures you control get +1/+0" — is an
// owner-scoped layer-7d anthem collected with NO permanent source
// (`convex/gre/layers.ts`; the definition lives in `convex/cards/emblems.ts`).
// The +1 and −2 reuse ONLY already-exercised machinery (createToken, the new
// emblem Op), so no hand-written per-card test is required for them (per-Op
// regime, ADR 0045/0046); the emblem Op earns its own interpreter + wire test.
//
//   • +1 — Create a 1/1 black Vampire with lifelink: `createToken` with a plain
//     static P/T + lifelink spec.
//   • −2 — the emblem: the new `emblem` Op (the subsystem's new primitive).
//   • −6 — Destroy up to three target creatures and/or other planeswalkers:
//     three per-slot `destroy` Ops over an up-to-3 target group (an unfilled
//     slot no-ops). Deferred / DIVERGENCE: the reanimation clause ("Return each
//     card put into a graveyard this way to the battlefield under your
//     control") and the "OTHER planeswalkers" self-exclusion are NOT
//     implemented — the destroy-then-return-same-set linkage needs a primitive
//     the DSL lacks. tracked-by: #1227.
export const sorinLordOfInnistrad: CardDefinition = {
    id: "27bb371f-d49f-41bd-bbe0-d5e1e2067e36",
    name: "Sorin, Lord of Innistrad",
    rarity: "mythic",
    manaCost: { X: 2, W: 1, B: 1 },
    types: ["Planeswalker"],
    subtypes: ["Sorin"],
    supertypes: ["Legendary"],
    loyalty: 3,
    oracleText:
        '+1: Create a 1/1 black Vampire creature token with lifelink.\n−2: You get an emblem with "Creatures you control get +1/+0."\n−6: Destroy up to three target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control.',
    activatedAbilities: [
        {
            id: "sorin-lord-of-innistrad-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Create a 1/1 black Vampire creature token with lifelink.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Vampire",
                        types: ["Creature"],
                        subtypes: ["Vampire"],
                        power: 1,
                        toughness: 1,
                        colors: ["B"],
                        staticAbilities: ["lifelink"],
                    },
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "sorin-lord-of-innistrad-minus2",
            cost: { loyalty: -2 },
            useStack: true,
            oracleText:
                '−2: You get an emblem with "Creatures you control get +1/+0."',
            effects: [
                { op: "emblem", emblem: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID },
            ],
        },
        {
            id: "sorin-lord-of-innistrad-minus6",
            cost: { loyalty: -6 },
            useStack: true,
            oracleText:
                "−6: Destroy up to three target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control.",
            targetRequirement: {
                type: ["Creature", "Planeswalker"],
                count: { min: 0, max: 3 },
            },
            // An unfilled target slot resolves to `undefined`, so `destroy`
            // no-ops it — the three Ops cover "up to three." Reanimation clause
            // + "other" self-exclusion deferred (see header, #1227).
            effects: [
                { op: "destroy", target: { target: 0 } },
                { op: "destroy", target: { target: 1 } },
                { op: "destroy", target: { target: 2 } },
            ],
        },
    ],
};
