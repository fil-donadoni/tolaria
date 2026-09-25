/**
 * "Is this activated ability a drain EXCHANGE?" — a static property of an
 * Effect Script, read by the search's below-the-root sacrifice prune
 * (issue #4277).
 *
 * The shape: the ability's cost gives up a permanent (CR 701.21a — the
 * sacrifice is a cost, CR 118.1) and its WHOLE script is a drain: an announced
 * target player loses life (CR 119.3) and the controller gains it back
 * (CR 119.3), "Sacrifice this creature: Target player loses 1 life and you gain
 * 1 life". Such an activation trades a permanent for a life swing worth the
 * same few points whenever it is taken; it creates no card, no mana and no
 * damage, and the body it spends is worth more standing. The search still
 * opens its variants (one per victim and target) at every node below a cast,
 * where they outnumber `pass` and drag the cast edge under it.
 *
 * FAILS CLOSED, like `abilityIsDiscardExchange`: answers `true` only for a
 * script it can positively read. An imperative `resolve()`, a mode, a mana
 * rider, a structural construct, an unknown Op, a gain aimed anywhere but the
 * controller, or any extra Op answers `false` and leaves the line searchable.
 *
 * Bot decision quality only; engine legality is untouched.
 */

import type { ActivatedAbility, EffectOp } from "../../cards/types";

/** A player selector naming the announced target (`{ target: N }`). */
function namesAnnouncedPlayer(selector: unknown): boolean {
    return (
        !!selector &&
        typeof selector === "object" &&
        typeof (selector as { target?: unknown }).target === "number"
    );
}

function opIsDrainLeg(op: EffectOp): boolean {
    if (op.op === "loseLife") return namesAnnouncedPlayer(op.player);
    if (op.op === "gainLife") return op.player === "controller";
    return false;
}

/** True only when the ability's whole script makes an announced target player
 *  lose life and its controller gain life. */
export function abilityIsDrainExchange(ability: ActivatedAbility): boolean {
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
    // A drain needs BOTH legs: a lone loss or a lone gain is a different shape.
    if (!effects.some((op) => op.op === "loseLife")) return false;
    if (!effects.some((op) => op.op === "gainLife")) return false;
    return effects.every(opIsDrainLeg);
}
