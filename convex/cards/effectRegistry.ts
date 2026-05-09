// Declarative effect shorthand → resolve closure mapping. Cards that opt into
// `effect: "<shorthand>"` on their `CardDefinition` get their resolve compiled
// from this registry instead of declaring an imperative `resolve()` body.
//
// Add a new shorthand here as soon as the same `resolve` body repeats across
// two cards (rule of two extraction, see feedback_extract_after_second.md).

import type { CardDefinition, EffectShorthand, SpellContext } from "./types";

type ResolveFn = (ctx: SpellContext) => void;

export const EFFECT_REGISTRY: Record<EffectShorthand, ResolveFn> = {
    // CR 701.7 — "destroy target X". Routes through the regen/indestructible
    // replacement layer via `ctx.destroy`. Used by Disenchant, Sinkhole.
    "destroy-target": (ctx) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target);
    },
};

/** Returns the resolve closure for a single-shot spell. Prefers `resolve` /
 *  `resolveSteps` when present (engine handles `resolveSteps` separately),
 *  otherwise compiles `effect` via the registry. Throws if a card declares
 *  both an imperative resolve and a declarative `effect` — they're mutually
 *  exclusive and combining them is a definition bug. */
export function getResolveFn(def: CardDefinition): ResolveFn | undefined {
    const hasImperative = !!def.resolve || !!def.resolveSteps;
    if (hasImperative && def.effect) {
        throw new Error(
            `Card "${def.name}" (${def.id}) declares both imperative resolve and effect shorthand "${def.effect}" — these are mutually exclusive`
        );
    }
    if (def.resolve) return def.resolve;
    if (def.effect) return EFFECT_REGISTRY[def.effect];
    return undefined;
}
