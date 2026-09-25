/**
 * "Is this activated ability a removal EXCHANGE?" — a static property of an
 * Effect Script, read by the search's below-the-root sacrifice prune
 * (issue #4272).
 *
 * The shape: the ability's cost gives up a permanent (CR 701.21a — the
 * sacrifice is a cost, CR 118.1) and its WHOLE script removes an announced
 * target with `dealDamage` or `destroy` ("Sacrifice this creature: it deals 1
 * damage to target creature", "{1}{R}, Sacrifice a Goblin: … deals 4 damage
 * to target creature"). Such an activation trades one permanent for one
 * permanent: it creates no card, no mana, no life and no damage to a player,
 * so it redistributes worth and is no step up from passing. The search still
 * opens its variants (one per victim and target) at every node below a cast,
 * where they outnumber `pass` and drag the cast edge under it.
 *
 * FAILS CLOSED, like `abilityBenefitIsConfinedToSource`: answers `true` only
 * for a script it can positively read. An imperative `resolve()`, a mode, a
 * mana rider, a structural construct, an unknown Op, a player-scoped damage
 * (`{ player }` — burn to the face creates damage, not an exchange) or any
 * second Op answers `false` and leaves the line searchable.
 *
 * Bot decision quality only; engine legality is untouched.
 */

import type { ActivatedAbility, EffectOp } from "../../cards/types";

/** An announced-target selector (`{ target: N }`) — the only spelling that
 *  reads as "an object the ability was aimed at". A `$source`/`$each` ref, a
 *  player reference or a missing selector all answer `false`. */
function namesAnnouncedTarget(selector: unknown): boolean {
    return (
        !!selector &&
        typeof selector === "object" &&
        typeof (selector as { target?: unknown }).target === "number"
    );
}

function opRemovesAnnouncedTarget(op: EffectOp): boolean {
    if (op.op === "dealDamage") return namesAnnouncedTarget(op.to);
    if (op.op === "destroy") return namesAnnouncedTarget(op.target);
    return false;
}

/** True only when the ability's whole script removes announced targets. */
export function abilityIsRemovalExchange(ability: ActivatedAbility): boolean {
    if (ability.resolve || ability.resolveSteps || ability.effect) return false;
    if (
        ability.manaProduced ||
        ability.manaAmount ||
        ability.manaChoices ||
        ability.getManaChoices
    ) {
        return false;
    }
    if (ability.modes && ability.modes.length > 0) return false;
    const effects = ability.effects;
    if (!effects || effects.length === 0) return false;
    return effects.every(opRemovesAnnouncedTarget);
}
