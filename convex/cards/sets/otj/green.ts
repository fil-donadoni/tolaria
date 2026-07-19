// OTJ — green cards, split by colour per ADR 0043. The registry's
// `import * as otj from "./sets/otj"` resolves through otj/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Bristly Bill, Spine Sower — {1}{G} Legendary Creature — Plant Druid, 2/2.
// First card of the Landfall CAP (issue #694). The landfall clause is the
// canonical Landfall ability word (CR 702 preamble — italic, no independent
// rules meaning), modelled by the shared `landfallTrigger` factory (a
// `PERMANENT_ENTERED` trigger gated to Lands you control, CR 603.6a / 109.2).
//
// The landfall effect ("put a +1/+1 counter on TARGET creature" — any creature
// on EITHER battlefield) declares a real `targetRequirement` on the
// TriggeredAbility, so its target is chosen when the trigger is PUT ON THE
// STACK (CR 603.3d, issue #1193 machinery: `raiseTriggerTargetSelection` in
// `gre/rules.ts` populates the on-stack trigger's `targets`), NOT at resolution
// via a `requestChoice`. That makes the counter subject to hexproof /
// protection / ward and fires "becomes the target of an ability" triggers,
// which the old choice-as-target workaround silently skipped. `type:
// "Creature"` with no controller restriction matches "target creature" on
// either battlefield; `count: 1` is a mandatory single target (auto-selected
// when exactly one creature is legal). The `resolve` then only reads the
// announced target (`ctx.targets[0]`) and adds the counter — the `addCounter`
// primitive keeps this on `resolve` rather than pure DSL, but the targeting is
// now engine-native.
//
// (NOTE: the `landfallTrigger` factory does not yet forward `targetRequirement`
// the way its `enteredTrigger` base already does, so it is spread onto the
// returned ability here.)
//
// The activated ability ("Double the number of +1/+1 counters on each creature
// you control") IS pure DSL: a `forEach` over your creatures adding, per
// creature, a number of +1/+1 counters equal to the count already present —
// the `counters` Op with a `counters` EffectValue count (CR 122.6, issue
// #1015). Doubling N via "add N more" needs no new Op.
export const bristlyBillSpineSower: CardDefinition = {
    id: "52eef0d6-24b7-40b7-8403-e8e863d0cd55",
    rarity: "rare",
    name: "Bristly Bill, Spine Sower",
    oracleText:
        "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature.\n{3}{G}{G}: Double the number of +1/+1 counters on each creature you control.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Plant", "Druid"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            ...landfallTrigger({
                id: "bristly-bill-landfall",
                oracleText:
                    "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature.",
                resolve: (ctx) => {
                    // CR 603.3d — the target was chosen when the trigger went on
                    // the stack (`raiseTriggerTargetSelection`); read it here.
                    const target = ctx.targets[0];
                    if (!target) return; // CR 608.2b — target left / illegal
                    ctx.addCounter(
                        { type: "permanent", id: target.id },
                        "+1/+1",
                        1
                    );
                },
            }),
            // CR 603.3d — "target creature": a real target chosen at stack
            // placement (any creature on either battlefield, no controller
            // restriction), `count: 1` mandatory single.
            targetRequirement: { type: "Creature", count: 1 },
        },
    ],
    activatedAbilities: [
        {
            id: "bristly-bill-double-counters",
            oracleText:
                "{3}{G}{G}: Double the number of +1/+1 counters on each creature you control.",
            cost: { mana: { X: 3, G: 2 } },
            useStack: true,
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
                            // Double = add a number of +1/+1 counters equal to
                            // the count already on the creature (CR 122.6 read
                            // via the `counters` EffectValue).
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: {
                                counters: {
                                    of: { ref: "$each" },
                                    type: "+1/+1",
                                },
                            },
                        },
                    ],
                },
            ],
        },
    ],
};
