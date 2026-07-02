// Declarative effect shorthand → resolve closure mapping. Cards that opt into
// `effect: "<shorthand>"` on their `CardDefinition` get their resolve compiled
// from this registry instead of declaring an imperative `resolve()` body.
//
// Add a new shorthand here as soon as the same `resolve` body repeats across
// two cards (rule of two extraction, see feedback_extract_after_second.md).

import type { CardDefinition, PumpCombatEffect, SpellContext } from "./types";
import { compileEffectScript } from "../gre/effects/interpreter";

type ResolveFn = (ctx: SpellContext) => void;

/** Registry for the param-less string shorthands. Parametric shorthands
 *  (object form, e.g. `pump-combat`) are dispatched in `getResolveFn`. */
export const EFFECT_REGISTRY: Record<string, ResolveFn> = {
    // CR 701.7 — "destroy target X". Routes through the regen/indestructible
    // replacement layer via `ctx.destroy`. Used by Disenchant, Sinkhole.
    "destroy-target": (ctx) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target);
    },
};

/** CR 611.2 — pump every attacking/blocking creature on the battlefield by a
 *  fixed amount until end of turn. "Attacking creatures" / "blocking creatures"
 *  span both players' battlefields, so iterate every player. */
function applyPumpCombat(ctx: SpellContext, effect: PumpCombatEffect): void {
    const filter =
        effect.side === "attacking"
            ? { isAttacking: true }
            : { isBlocking: true };
    for (const playerId of ctx.allPlayerIds) {
        for (const id of ctx.getBattlefieldIds(playerId, filter)) {
            ctx.addTemporaryPTBuff(
                { type: "permanent", id },
                effect.power,
                effect.toughness,
                { phase: "end-of-turn" }
            );
        }
    }
}

/** Returns the resolve closure for a single-shot spell. Prefers `resolve` /
 *  `resolveSteps` when present (engine handles `resolveSteps` separately),
 *  otherwise compiles the Effect Script `effects[]` (ADR 0045) or the
 *  `effect` shorthand via the registry. Throws if a card declares more than
 *  one authoring mode for the spell's effect site (imperative resolve,
 *  `effects[]`, `effect` shorthand) — they're mutually exclusive and
 *  combining them is a definition bug (also caught statically by the
 *  catalogue-wide `validateEffectScript` sweep). */
export function getResolveFn(def: CardDefinition): ResolveFn | undefined {
    const declaredModes = [
        def.resolve || def.resolveSteps ? "imperative resolve" : null,
        def.effects ? "effects[] script" : null,
        def.effect
            ? `effect shorthand "${typeof def.effect === "string" ? def.effect : def.effect.kind}"`
            : null,
    ].filter((m): m is string => m !== null);
    if (declaredModes.length > 1) {
        throw new Error(
            `Card "${def.name}" (${def.id}) declares ${declaredModes.join(" and ")} — these are mutually exclusive`
        );
    }
    if (def.resolve) return def.resolve;
    // ADR 0045 — Effect Script: compiled onto the same closure seam, so the
    // stack-resolution engine has one execution path for every authoring mode.
    if (def.effects) return compileEffectScript(def.effects);
    if (def.effect) {
        if (typeof def.effect === "string") {
            return EFFECT_REGISTRY[def.effect];
        }
        const effect = def.effect;
        if (effect.kind === "pump-combat") {
            return (ctx) => applyPumpCombat(ctx, effect);
        }
    }
    return undefined;
}
