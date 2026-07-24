// M3C — red cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c"` resolves through m3c/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    GameEvent,
    PermanentEnteredEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
} from "../../types";
import { EFFECT_AFFECTS_SELF } from "../../types";

// Pyrogoyf — {3}{R} Creature — Lhurgoyf, printed */1+* (Vintage Cube FREE
// wave 3, issue #1528, parent PRD #1525). "Pyrogoyf's power is equal to the
// number of card types among cards in all graveyards and its toughness is
// equal to that number plus 1. Whenever this creature or another Lhurgoyf
// creature you control enters, that creature deals damage equal to its power
// to any target."
//
// P/T HALF (CR 604.3 / 613.4c CDA, layer 7a): a `pt-cda` static effect whose
// `compute` counts DISTINCT card types among cards in ALL graveyards — the
// IDENTICAL shape already shipped for Barrowgoyf (m3c/black.ts); reused
// verbatim (the one card-type-count-across-all-graveyards CDA).
//
// TRIGGER HALF: an ENTER trigger with an announced "any target"
// (`targetRequirement.type: "any"`, targets chosen when the trigger is put on
// the stack, CR 603.3d / issue #1193). It fires for THIS creature and for
// ANY OTHER Lhurgoyf creature the controller controls (Pyrogoyf is itself a
// Lhurgoyf, so the `matches` predicate is simply "an entering Lhurgoyf
// creature you control", which subsumes the self case). `resolve()` (not a
// DSL Effect Script) is required — protocol justification: the damage amount
// is "that creature's power", the CURRENT power of the ENTERING permanent read
// off the firing `PERMANENT_ENTERED` event (`event.instanceId`), a runtime
// value with no `EffectValue` grammar member (an Effect Script cannot read the
// firing event, ADR 0049 — the same class as Barrowgoyf's `event.amount` read
// next door). The `aiEffects` shadow gives the bot's value model a burn-shaped
// script to walk (PRD #1423 / issue #1519), since a bare `resolve()` ability
// is otherwise AI-blind.
//
// DIVERGENCE (source attribution): `SpellContext.dealDamage` always sources
// the damage from the resolving ability's own permanent (Pyrogoyf) — there is
// no per-call source override (`gre/state.ts` `dealDamage` reads the stack
// item's source). For Pyrogoyf's own ETB this is exactly correct; for the
// "another Lhurgoyf you control enters" branch the oracle attributes the
// damage to THAT creature, so a source-dependent rider on the entering
// creature (deathtouch / lifelink / "damage from a red source") is evaluated
// against Pyrogoyf, not the entering Lhurgoyf. The damage amount and target
// are correct; only the source identity diverges, and only for that branch.
// tracked-by: #1528
export const pyrogoyf: CardDefinition = {
    id: "f60be310-4461-4b84-95f0-b2095108bd79",
    name: "Pyrogoyf",
    rarity: "rare",
    oracleText:
        "Pyrogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.\nWhenever this creature or another Lhurgoyf creature you control enters, that creature deals damage equal to its power to any target.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Lhurgoyf"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            // CR 604.3 — power = distinct card types among cards in ALL
            // graveyards; toughness = that + 1 (Lhurgoyf-style CDA, layer 7a).
            // Same compute as Barrowgoyf (m3c/black.ts).
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (_source, state) => {
                const types = new Set<string>();
                for (const player of state.players) {
                    for (const c of player.graveyard) {
                        for (const t of c.types) types.add(t);
                    }
                }
                const n = types.size;
                return { power: n, toughness: n + 1 };
            },
        },
    ],
    triggeredAbilities: [
        {
            id: "pyrogoyf-lhurgoyf-enters",
            oracleText:
                "Whenever this creature or another Lhurgoyf creature you control enters, that creature deals damage equal to its power to any target.",
            event: "PERMANENT_ENTERED",
            // "this creature or another Lhurgoyf creature you control": an
            // entering creature the source's controller controls whose
            // subtypes include Lhurgoyf. `event.instanceId === self.id` short-
            // circuits the self case (Pyrogoyf's own ETB) before the
            // battlefield lookup, which also covers it (Pyrogoyf is a
            // Lhurgoyf). `state` is the live game state passed by
            // `collectTriggers` (gre/triggers.ts) — structurally a
            // `TriggerStateView`, battlefield rows carry `subtypes`.
            matches: (
                event: GameEvent,
                self: PermanentView,
                state?: TriggerStateView
            ): boolean => {
                if (event.type !== "PERMANENT_ENTERED") return false;
                if (event.controllerId !== self.controllerId) return false;
                if (event.instanceId === self.id) return true;
                const entering = state?.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === event.instanceId);
                return (
                    !!entering &&
                    entering.types.includes("Creature") &&
                    entering.subtypes.includes("Lhurgoyf")
                );
            },
            // CR 603.3d — target chosen when the trigger is put on the stack.
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const event = ctx.triggerEvent as
                    | PermanentEnteredEvent
                    | undefined;
                if (!event || event.type !== "PERMANENT_ENTERED") return;
                const target = ctx.targets[0];
                if (!target) return; // no legal target announced (CR 603.3c)
                // "damage equal to its power" — the entering creature's CURRENT
                // power (Pyrogoyf's CDA, or the other Lhurgoyf's own power).
                const power = ctx.getPower({
                    type: "permanent",
                    id: event.instanceId,
                });
                if (power <= 0) return;
                ctx.dealDamage(target, power);
            },
            // aiEffects (PRD #1423, issue #1431/#1519) — a bare `resolve()`
            // ability (the amount reads the firing event, no Op skin), so the
            // bot's `cardValueById`/`latentValue` value model has nothing to
            // walk without a shadow. A representative burn to the announced
            // target: `amount` is a fixed proxy (the real amount is the
            // graveyard-type CDA, typically a few points), standing in for the
            // "deal damage equal to power to any target" removal upside.
            aiEffects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
        },
    ],
};
