// Declarative effect shorthand → resolve closure mapping. Cards that opt into
// `effect: "<shorthand>"` on their `CardDefinition` get their resolve compiled
// from this registry instead of declaring an imperative `resolve()` body.
//
// Add a new shorthand here as soon as the same `resolve` body repeats across
// two cards (rule of two extraction, see feedback_extract_after_second.md).

import type {
    AbilityMode,
    ActivatedAbility,
    CardDefinition,
    EffectOp,
    PumpCombatEffect,
    SpellContext,
    TriggeredAbility,
} from "./types";
import { compileEffectScript } from "../gre/effects/interpreter";

type ResolveFn = (ctx: SpellContext) => void;

/** Registry for the param-less string shorthands. Parametric shorthands
 *  (object form, e.g. `pump-combat`) are dispatched in `getResolveFn`. */
export const EFFECT_REGISTRY: Record<string, ResolveFn> = {
    // CR 701.8 — "destroy target X". Routes through the regen/indestructible
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

/** How a resolution body RESUMES after a mid-resolution suspension (ADR 0100
 *  D5, issue #2570). `"checkpointed"` = a stepped `resolveSteps` loop or an
 *  Effect Script, both of which record a resume position and have work left;
 *  `"completed"` = a plain imperative closure, which carries no checkpoint and
 *  has already returned by the time a suspension is tested for. Lives here,
 *  beside `getResolveFn`, because the classification IS that function's
 *  dispatch order read back — keeping the two in one file is what stops them
 *  drifting when a fourth authoring mode arrives. */
export type ResolutionBodyShape = "checkpointed" | "completed";

/** The resume shape of the closure {@link getResolveFn} returns for `def`.
 *  `def.effects` compiles to an Effect Script (checkpointed); `def.resolve` and
 *  the `def.effect` shorthand are plain imperative bodies — the returned
 *  closures are indistinguishable, so the definition is the only discriminator.
 *  (`def.resolveSteps` never reaches `getResolveFn`: the stepped-spell branch in
 *  `resolveTopOfStackInner` handles it first, and it is checkpointed there.) */
export function spellBodyShape(def: CardDefinition): ResolutionBodyShape {
    return def.effects ? "checkpointed" : "completed";
}

/** The narrow slice an ability shares for effect-site dispatch — an id (for a
 *  legible error), an optional Effect Script, and the two imperative forms it
 *  is mutually exclusive with. Both `ActivatedAbility` and `TriggeredAbility`
 *  satisfy it structurally. */
type AbilityEffectHost = {
    id: string;
    effects?: EffectOp[];
    resolve?: unknown;
    resolveSteps?: unknown;
};

/** Compiles an ability-site Effect Script (ADR 0045, issue #803) onto the SAME
 *  resolve-closure seam as spell-site scripts — the interpreter never grows a
 *  second execution path, and the ability's `SpellContext` (built once at the
 *  stack-resolution site) supplies the correct controller and source
 *  permanent. Returns `undefined` when the ability declares no `effects[]` (it
 *  resolves imperatively). Throws when an ability declares both `effects[]` and
 *  `resolve`/`resolveSteps` — the two authoring modes are mutually exclusive
 *  per effect site (also caught statically by the catalogue-wide
 *  `validateEffectScript` sweep). */
export function getAbilityEffectFn(
    ability: AbilityEffectHost
): ResolveFn | undefined {
    if (!ability.effects) return undefined;
    if (ability.resolve || ability.resolveSteps) {
        const other = ability.resolve ? "resolve" : "resolveSteps";
        throw new Error(
            `Ability "${ability.id}" declares both effects[] and ${other} — these are mutually exclusive`
        );
    }
    return compileEffectScript(ability.effects);
}

// Structural conformance guards — a compile error here means an ability type
// grew a shape `getAbilityEffectFn` can no longer accept.
const _actConforms: (a: ActivatedAbility) => ResolveFn | undefined =
    getAbilityEffectFn;
const _trigConforms: (a: TriggeredAbility) => ResolveFn | undefined =
    getAbilityEffectFn;
// CR 700.2 / 602.2b (issue #1341) — a modal activated ability's chosen mode
// resolves through the SAME seam as the ability itself.
const _abilityModeConforms: (m: AbilityMode) => ResolveFn | undefined =
    getAbilityEffectFn;
void _actConforms;
void _trigConforms;
void _abilityModeConforms;
