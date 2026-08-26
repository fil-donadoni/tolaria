/**
 * "Does this activated ability's benefit live entirely on its own source?"
 * — a static property of an Effect Script, read by the bot's activation-cost
 * enumerator (issue #2297).
 *
 * THE DECISION IT SERVES. An activation cost of the shape "Sacrifice a
 * creature:" (`cost.sacrificeFilter`, CR 118.5 / 701.21 Sacrifice) does not say
 * "another" (CR 109.2), so the ability's own source is a legal victim of its
 * own cost. Naming it is legal — the engine offers it to a human and always
 * will — but for an ability whose effect is delivered ONLY to `$source` it is
 * self-defeating: the cost is paid, the source is in the graveyard before the
 * ability resolves, and the resolution does nothing at all (CR 609.3 — an
 * effect that attempts the impossible does only as much as possible, which
 * here is nothing at all). The bot spent a creature
 * for an empty resolution.
 *
 * WHY A PREDICATE OVER THE Op VOCABULARY, and not a rule about sacrifice
 * costs. The distinction that matters is NOT "does the source match the cost
 * filter" — it is "is the source's continued presence load-bearing for the
 * effect's value". A sac outlet that draws, adds mana, damages an opponent or
 * reanimates something keeps self-sacrifice as a genuinely correct line (the
 * last creature before a wrath; denying an opponent's gain-control effect),
 * and pruning those would be invisible damage. So the question is asked of the
 * ability's `effects[]`, one Op at a time.
 *
 * IT FAILS CLOSED, and the asymmetry is the whole design. A wrongly-PRUNED
 * line is invisible — the bot simply never considers a play, and nothing in
 * the suite or a game log says so. A wrongly-KEPT line merely costs a little
 * search width, and the search's own evaluation is free to reject it. So this
 * answers `true` only for a script it can positively prove is confined to
 * `$source`: an unknown Op, a structural construct, a second Op with any other
 * scope, an imperative `resolve()`, a mode, or a mana rider all answer
 * `false` and leave the line searchable.
 *
 * SCOPE. Bot decision quality only. Engine legality is untouched: the server's
 * `buildActivationSacrificeSelection` still offers the source as a victim, and
 * a human may still name it.
 */

import type { ActivatedAbility, EffectOp, EffectRef } from "../../cards/types";
import { SOURCE_BINDING } from "../effects/interpreter";

/**
 * Ops whose ENTIRE observable outcome is delivered to the single battlefield
 * permanent named by their `target` field. Each one modifies that permanent
 * and leaves nothing else behind, so with the permanent already gone the Op is
 * a no-op and the ability's resolution is empty.
 *
 * Every row is a characteristic- or state-modifying Op in the CR 613 layer
 * system, or a shield/restriction attached to the object itself:
 *
 *   - `pump` (CR 611.1, layer 7c) — a P/T buff on the named permanent.
 *   - `counters` (CR 122) — counters put on or removed from it.
 *   - `tapUntap` (CR 701.26 Tap and Untap) — its tapped status.
 *   - `skipNextUntap` (CR 302.6 / 502.1) — a restriction carried by it.
 *   - `grantAbility` (CR 613.1f, layer 6) — an ability it gains.
 *   - `addSubtype` / `setSubtype` (layer 4) — its subtypes.
 *   - `setColor` (layer 5) — its colors.
 *   - `setCardTypes` (layer 4) — its card types.
 *   - `animate` / `setBasePT` (layers 4 / 7b) — its type line and base P/T.
 *   - `regenerate` (CR 701.19 Regenerate) — a regeneration shield on it.
 *   - `preventDamage` (CR 615) — a prevention shield on it. Its
 *     player-scoped and `all-combat` shapes carry no `target` at all and are
 *     rejected by the `$source` check below, not by this list.
 *
 * DELIBERATELY ABSENT, though they can name `$source`: `destroy`, `moveZone`,
 * `sacrifice`, `exile*`, `gainControl`, `transform`. Each of those SPENDS or
 * RELOCATES the source rather than improving it, so "the source is already
 * gone" is not obviously the same as "this was worthless" — a self-bounce or a
 * self-exile can be the point of the card. Fail-closed: they keep the line
 * searchable.
 *
 * Also absent, and load-bearing: every Op that produces value away from the
 * source — `draw`, `addMana`, `dealDamage`, `gainLife`, `createToken`,
 * `mill`, … — which is exactly what makes a real sac outlet's self-sacrifice
 * survive this predicate.
 */
const SOURCE_CONFINED_OPS: ReadonlySet<string> = new Set([
    "pump",
    "counters",
    "tapUntap",
    "skipNextUntap",
    "grantAbility",
    "addSubtype",
    "setSubtype",
    "setColor",
    "setCardTypes",
    "animate",
    "setBasePT",
    "regenerate",
    "preventDamage",
]);

/** `$source` is the sole spelling of a self-reference in the DSL — there is no
 *  `self: true` flag and no `"$this"` (`effects/targetRef.ts` reserves exactly
 *  `$source` / `$each` / `$target<N>`). A `{ target: N }` announced slot, a
 *  `$each` member, or a missing selector all answer `false`. */
function namesSource(selector: unknown): boolean {
    if (!selector || typeof selector !== "object") return false;
    if (!("ref" in selector)) return false;
    return (selector as EffectRef).ref === SOURCE_BINDING;
}

/** One Op is confined when it is on the allowlist AND the permanent it names
 *  is the resolving source. */
function opIsConfinedToSource(op: EffectOp): boolean {
    if (!SOURCE_CONFINED_OPS.has(op.op)) return false;
    return namesSource((op as { target?: unknown }).target);
}

/**
 * True only when EVERY effect this ability would produce lands on its own
 * source, so an activation that has already sacrificed the source resolves to
 * nothing.
 *
 * A script mixing a `$source` buff with any independent Op ("…gets +2/+1 and
 * you draw a card") answers `false`: the draw survives the source's death and
 * the line stays worth searching.
 */
export function abilityBenefitIsConfinedToSource(
    ability: ActivatedAbility
): boolean {
    // An imperative escape hatch is opaque to Op analysis (ADR 0045 — a
    // protocol card's `resolve()` may do anything). Never prune it.
    if (ability.resolve || ability.resolveSteps || ability.effect) return false;
    // A mana ability's payoff is the pool, which outlives the source
    // (CR 605.1a). `manaProduced` / `manaAmount` / `manaChoices` /
    // `getManaChoices` are all riders the Op walk below cannot see.
    if (
        ability.manaProduced ||
        ability.manaAmount ||
        ability.manaChoices ||
        ability.getManaChoices
    ) {
        return false;
    }
    // A modal ability (CR 700.2) has a per-mode script this walk does not
    // reach; the enumerator emits one move per mode and cannot be pruned on
    // the ability as a whole.
    if (ability.modes && ability.modes.length > 0) return false;
    const effects = ability.effects;
    // No script at all: nothing to prove. (A keyword-only or rider-only
    // ability is not something this predicate may speak for.)
    if (!effects || effects.length === 0) return false;
    return effects.every(opIsConfinedToSource);
}
