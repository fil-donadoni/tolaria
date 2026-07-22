// MH3 — red cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, SpellContext } from "../../types";

// Galvanic Discharge — "{R} Instant. Choose target creature or planeswalker.
// You get {E}{E}{E} (three energy counters), then you may pay any amount of
// {E}. Galvanic Discharge deals that much damage to that permanent."
//
// Energy resource (CR 122.1) — the Cube CAP Energy mechanic (issue #697). The
// GENERATION half ("you get {E}{E}{E}") is `SpellContext.addEnergy`, the same
// primitive the `getEnergy` Effect Script Op skins; the SPENDING half ("pay any
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
// exactly like Nameless Race's "pay any amount of life" (drk/black.ts): a
// `requestOptionChoice` over 0..pool. Split into two steps so the "you get
// {E}{E}{E}" mutation (step 0) runs ONCE and is not re-applied when the pay
// choice (step 1) suspends/resumes (CR 608.3 stepped resolution).
export const galvanicDischarge: CardDefinition = {
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
};
