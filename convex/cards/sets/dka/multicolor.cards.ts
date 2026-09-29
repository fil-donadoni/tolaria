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
//   • −6 — Destroy up to three target creatures and/or other planeswalkers,
//     then return each card put into a graveyard this way to the battlefield
//     under your control (issue #1469, closing #1227). Three per-slot
//     `destroy` Ops over an up-to-3 target group (an unfilled slot no-ops),
//     each `bind`-snapshotting its target, followed by three `moveZone
//     { ref, from: "graveyard", to: "battlefield", controller: "controller" }`
//     Ops. The "this way" linkage is the snapshot id plus `moveZone`'s
//     post-move zone re-check: a target that survived (indestructible /
//     regenerated), one a replacement effect redirected to exile, and a token
//     (CR 704.5d) are all simply not in a graveyard at that point, so the
//     return no-ops (CR 608.2b). "OTHER planeswalkers" is a target-filter
//     concern, expressed through the single-authority path — a dynamic
//     `getTargetRequirement(source)` injecting `excludeInstanceIds: [source.id]`,
//     so `getLegalTargets` and `selectTarget` agree (CR 601.2c).
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
            // "…and/or OTHER planeswalkers" (CR 601.2c) — Sorin is never a
            // legal target of its own −6. Expressed through the SINGLE
            // authority both `getLegalTargets` and `selectTarget` read
            // (`excludeInstanceIds` → `intrinsicPermanentTargetViolation`), so
            // offered == accepted; a UI-only filter is the known bug class.
            // An activated ability has no `triggerSourceId`, so the reflexive
            // `excludeSource` flag (triggered-only) does not apply — the
            // documented activated-ability form is this dynamic requirement.
            getTargetRequirement: (source) => ({
                type: ["Creature", "Planeswalker"],
                count: { min: 0, max: 3 },
                excludeInstanceIds: [source.id],
            }),
            // An unfilled target slot resolves to `undefined`, so `destroy`
            // no-ops it — the three Ops cover "up to three." Each `destroy`
            // `bind`s its target (CR 608.2h last-known information); the
            // paired `moveZone` re-derives that id IN THE GRAVEYARD at
            // execution time, which is exactly the "put into a graveyard THIS
            // WAY" linkage: a survivor / exile-redirect / token isn't there
            // and the return no-ops (CR 608.2b).
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$a" },
                { op: "destroy", target: { target: 1 }, bind: "$b" },
                { op: "destroy", target: { target: 2 }, bind: "$c" },
                {
                    op: "moveZone",
                    target: { ref: "$a" },
                    from: "graveyard",
                    to: "battlefield",
                    controller: "controller",
                },
                {
                    op: "moveZone",
                    target: { ref: "$b" },
                    from: "graveyard",
                    to: "battlefield",
                    controller: "controller",
                },
                {
                    op: "moveZone",
                    target: { ref: "$c" },
                    from: "graveyard",
                    to: "battlefield",
                    controller: "controller",
                },
            ],
        },
    ],
};
