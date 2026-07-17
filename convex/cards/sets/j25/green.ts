// J25 (Foundations Jumpstart) — green cards, split by colour per ADR 0043.
// The registry's `import * as j25 from "./sets/j25"` resolves through
// j25/index.ts. Cards are classified by the colour identity of their mana cost
// (CR 202.2).

import type { CardDefinition, TargetSelection } from "../../types";
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
// protocol: `TriggeredAbility` has no `targetRequirement` field — CR 603.3d
// announce-time targeting is not modeled for triggered abilities in this
// engine, and the Effect Script grammar has no bridge from a `choice` Op's
// "picks" binding into an object-position Op (`counters`) — `forEach { set:
// "bound" }` only accepts a delayedTrigger LIST capture (ADR 0049) and a bare
// object ref only accepts a "snapshot" family binding (see
// `convex/gre/effects/validate.ts`). This is the SAME established
// simplification `sets/znr/white.ts` (Luminarch Aspirant) and
// `sets/otj/green.ts` (Bristly Bill, Spine Sower) use for "target creature
// [you control]" triggered abilities: a resolution-time `choose-permanents`
// pick via `resolve()`, not a true announced target — tracked as a capability
// follow-up in tolaria#917. The escalation check itself
// (`ctx.getAbilityResolutionCount()`) and the counter placement
// (`ctx.addCounter`) are trivially DSL primitives; only the targeting forces
// `resolve` (`.claude/rules/gre-development.md` § DSL-first authoring).
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
        landfallTrigger({
            id: "scythecat-cub-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature you control. If this is the second time this ability has resolved this turn, double the number of +1/+1 counters on that creature instead.",
            resolve: (ctx) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `scythecat-cub-landfall-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: "Creature" },
                    count: 1,
                    prompt: "Landfall: put a +1/+1 counter on target creature you control.",
                });
                if (picks === undefined) return; // suspended for the choice
                const id = picks[0];
                if (!id) return; // CR 608.2b — nothing to target, no-op
                const target: TargetSelection = { type: "permanent", id };
                if (ctx.getAbilityResolutionCount() === 2) {
                    // "double the number of +1/+1 counters on that creature
                    // instead" — add a number of counters equal to the count
                    // already present (CR 122.6, mirrors Bristly Bill's own
                    // doubling activated ability).
                    const current = ctx.getCounterCount(target, "+1/+1");
                    ctx.addCounter(target, "+1/+1", current);
                } else {
                    ctx.addCounter(target, "+1/+1", 1);
                }
            },
        }),
    ],
};
