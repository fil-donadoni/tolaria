// J25 (Foundations Jumpstart) — green cards, split by colour per ADR 0043.
// The registry's `import * as j25 from "./sets/j25"` resolves through
// j25/index.ts. Cards are classified by the colour identity of their mana cost
// (CR 202.2).

import type { CardDefinition } from "../../types";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Scythecat Cub — {X}{G} Creature — Cat, 2/2, Trample. "Landfall — Whenever a
// land you control enters, put a +1/+1 counter on target creature you
// control. If this is the second time this ability has resolved this turn,
// double the number of +1/+1 counters on that creature instead." Was a
// tracked stub (#1189) blocked on a per-source per-turn ability-resolution
// counter the engine did not track — SHIPPED as the
// `{ abilityResolutionCount: true }` EffectValue grammar member
// (`GameState.abilityResolutionCounts`, `gre/state.ts`). The "double" half was
// already expressible via the `counters` EffectValue (issue #1015); only the
// resolution-count gate was missing.
//
// TARGETING (CR 603.3d): "target creature you control" is a REAL target chosen
// when the landfall trigger is put on the stack — declared as a
// `targetRequirement` on the TriggeredAbility (issue #1193 machinery,
// `raiseTriggerTargetSelection` in gre/rules.ts), NOT a resolution-time
// `requestChoice`. That makes it subject to hexproof / protection / ward and
// fires "becomes the target of an ability" triggers, which the old
// choice-as-target workaround silently skipped. The resolve() then only reads
// the announced slot (`ctx.targets[0]`) and applies the resolution-count-gated
// counter placement: the Effect Script grammar still has no bridge from an
// announced target into the doubling logic (an `abilityResolutionCount`-gated
// `getCounterCount` → `addCounter`), so the counter half stays an imperative
// resolve (`.claude/rules/gre-development.md` § DSL-first authoring).
export const scythecatCub: CardDefinition = {
    id: "b3dd3c7d-4685-4579-b483-14ddaaaddf5b",
    name: "Scythecat Cub",
    rarity: "common",
    oracleText:
        "Trample\nLandfall — Whenever a land you control enters, put a +1/+1 counter on target creature you control. If this is the second time this ability has resolved this turn, double the number of +1/+1 counters on that creature instead.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
    power: 2,
    toughness: 2,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        {
            ...landfallTrigger({
                id: "scythecat-cub-landfall",
                oracleText:
                    "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature you control. If this is the second time this ability has resolved this turn, double the number of +1/+1 counters on that creature instead.",
                resolve: (ctx) => {
                    // CR 603.3d — the target was locked when the trigger went
                    // on the stack (`raiseTriggerTargetSelection`); read it
                    // from the announced slot rather than picking now.
                    const target = ctx.targets[0];
                    if (!target) return; // CR 603.3c — required target gone / illegal
                    if (ctx.getAbilityResolutionCount() === 2) {
                        // "double the number of +1/+1 counters on that creature
                        // instead" — add a number of counters equal to the
                        // count already present (CR 122.6, mirrors Bristly
                        // Bill's own doubling activated ability).
                        const current = ctx.getCounterCount(target, "+1/+1");
                        ctx.addCounter(target, "+1/+1", current);
                    } else {
                        ctx.addCounter(target, "+1/+1", 1);
                    }
                },
            }),
            // CR 603.3d — "target creature you control": a real announced
            // target chosen at stack placement (issue #1193). `landfallTrigger`
            // does not forward `targetRequirement`, so it is attached here.
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
        },
    ],
};
