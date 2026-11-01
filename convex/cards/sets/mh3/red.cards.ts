// MH3 — red cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { AURA_AFFECTS_HOST, defineCard, type SpellContext } from "../../types";

// Galvanic Discharge — "{R} Instant. Choose target creature or planeswalker.
// You get {E}{E}{E} (three energy counters), then you may pay any amount of
// {E}. Galvanic Discharge deals that much damage to that permanent."
//
// Energy resource (CR 122.1) — the Cube CAP Energy mechanic (issue #697). The
// GENERATION half ("you get {E}{E}{E}") is `SpellContext.addEnergy`, the same
// primitive the `addPlayerCounter` Effect Script Op skins; the SPENDING half ("pay any
// amount of {E}") is `SpellContext.payEnergy`.
//
// NOT DSL-migratable (ADR 0045): `resolveSteps` (NOT DSL) because "pay ANY
// AMOUNT of {E}" is a VARIABLE resource payment whose chosen amount then feeds
// the damage dealt — a bounded numeric choice (0..current energy) the frozen
// Op grammar cannot express (there is no "choose a number ≤ resource" Op /
// EffectValue; `mayPay` pays a FIXED cost). Blocked on: a missing Op value
// construct — this is the PLANNED-migratable class (not protocol behaviour;
// nothing here restructures control flow), same shape as the X-value gap the
// playbook documents for Stream of Life / Earthquake. Worth an Op/EffectValue
// addition if the "pay any amount, deal that much" template recurs. Modeled
// exactly like Nameless Race's "pay any amount of life" (drk/black.cards.ts): a
// `requestOptionChoice` over 0..pool. Split into two steps so the "you get
// {E}{E}{E}" mutation (step 0) runs ONCE and is not re-applied when the pay
// choice (step 1) suspends/resumes (CR 608.3 stepped resolution).
export const galvanicDischarge = defineCard(() => ({
    id: "32aa6e33-221f-414c-9b51-850d97a7e051",
    rarity: "common",
    name: "Galvanic Discharge",
    oracleText:
        "Choose target creature or planeswalker. You get {E}{E}{E} (three energy counters), then you may pay any amount of {E}. Galvanic Discharge deals that much damage to that permanent.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
    },
    resolveSteps: [
        // Step 0 — "You get {E}{E}{E}" (CR 122.1). Runs exactly once; the pay
        // choice below suspends in a LATER step, so this energy gain is never
        // double-applied on resume.
        (ctx: SpellContext) => {
            ctx.addEnergy(ctx.controller, 3);
        },
        // Step 1 — "then you may pay any amount of {E}. [It] deals that much
        // damage to that permanent." The payable range is bounded by the
        // player's CURRENT energy (their pre-existing pool + the 3 just gained).
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (!target || target.type !== "permanent") return;
            const available = ctx.getEnergy(ctx.controller);
            const options = Array.from({ length: available + 1 }, (_, n) => ({
                id: String(n),
                label:
                    n === 0
                        ? "Pay no energy (deal no damage)"
                        : `Pay ${n} {E} — deal ${n} damage`,
            }));
            const choice = ctx.requestOptionChoice({
                playerId: ctx.controller,
                choiceId: `galvanic-discharge-pay-${ctx.sourceInstanceId}`,
                options,
                prompt: "Pay any amount of {E} — deals that much damage.",
            });
            if (choice === undefined) return; // suspended — wait for the pick
            const paid = Number(choice);
            if (paid <= 0) return; // paid nothing: no energy spent, no damage
            // CR 118.12 — all-or-nothing spend; the option list is capped at the
            // available pool, so this always succeeds.
            ctx.payEnergy(ctx.controller, paid);
            ctx.dealDamage(target, paid);
        },
    ],
}));

// Detective's Phoenix — {2}{R} Enchantment Creature — Phoenix 2/2 (issue
// #2074, the SECOND Bestow card). "Bestow—{R}, Collect evidence 6. / Flying,
// haste / Enchanted creature gets +2/+2 and has flying and haste. / You may
// cast this card from your graveyard using its bestow ability."
//
// No per-card code; every clause is a shipped mechanism:
//
//  1. Bestow (CR 702.103) is the `bestow` alternative cost, exactly as on
//     Springheart Nantuko (`green.cards.ts`); `gre/bestow.ts` owns the Aura
//     characteristic change and the unattached-reverts-to-a-creature rule
//     (CR 702.103f).
//  2. "Collect evidence 6" (CR 701.59a) is that alternative cost's
//     `collectEvidence` leg: the payer exiles any number of cards from their
//     graveyard with total mana value 6 or greater, picked through the cast's
//     graveyard-exile picker (`gre/collectEvidence.ts`). CR 701.59b — with
//     too little mana value in the graveyard the bestow cast is not offered.
//  3. The Aura half is the ordinary host-keyed `pt-buff` + `keyword-grant`
//     statics (CR 613 layers 7c / 6) — `attachedTo` is only ever set on this
//     permanent by a bestowed cast, so they switch off when it reverts.
//  4. "You may cast this card from your graveyard using its bestow ability"
//     is `castableFromOwnGraveyard` scoped to the bestow cost (CR
//     118.9b, `requiredGraveyardAlternativeCostId`): a printed-cost cast from
//     the graveyard is illegal, and the card is not exiled on resolution, so a
//     countered or dead Phoenix can be cast again.
// compiler-gap: "Bestow—{R}, Collect evidence 6." (#2693)
// compiler-gap: "You may cast this card from your graveyard using its bestow ability." (#2693)
export const detectivesPhoenix = defineCard(() => ({
    id: "e2a01edd-dbc0-4ed4-b827-9b608290e9a1",
    rarity: "rare",
    name: "Detective's Phoenix",
    oracleText:
        "Bestow—{R}, Collect evidence 6. (To pay this bestow cost, pay {R} and exile cards with total mana value 6 or greater from your graveyard.)\nFlying, haste\nEnchanted creature gets +2/+2 and has flying and haste.\nYou may cast this card from your graveyard using its bestow ability.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Phoenix"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "haste"],
    // CR 702.103a / 701.59a — "Bestow—{R}, Collect evidence 6": pay {R} and
    // collect evidence 6 rather than the mana cost.
    bestow: {
        id: "bestow",
        description:
            "Bestow—{R}, Collect evidence 6 (cast as an Aura — enchant creature)",
        mana: { R: 1 },
        collectEvidence: 6,
    },
    // CR 118.9b — castable from its owner's graveyard, but only
    // bestowed.
    castableFromOwnGraveyard: { requiredAlternativeCost: "bestow" },
    staticEffects: [
        // CR 613 layer 7c / 303.4m — "Enchanted creature gets +2/+2".
        { kind: "pt-buff", applies: AURA_AFFECTS_HOST, power: 2, toughness: 2 },
        // CR 613 layer 6 — "and has flying and haste".
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
        { kind: "keyword-grant", applies: AURA_AFFECTS_HOST, keyword: "haste" },
    ],
}));
