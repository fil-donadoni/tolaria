/**
 * "Is this activated ability a draw EXCHANGE?" — a static property of an
 * Effect Script, read by the search's below-the-root sacrifice prune
 * (issue #4279).
 *
 * The shape: the ability's cost gives up a permanent (CR 701.21a — the
 * sacrifice is a cost, CR 118.1) and its WHOLE script is a draw: the
 * controller or an announced target player draws cards (CR 121.1), "{2},
 * Sacrifice this creature: Target player draws a card". Such an activation
 * trades a standing body for a card; it creates no mana, no life and no
 * damage, and the body it spends is worth more standing. The search still
 * opens its variants (one per victim and target) at every node below a cast,
 * where they outnumber `pass` and drag the cast edge under it.
 *
 * FAILS CLOSED, like `abilityIsDrainExchange`: answers `true` only for a
 * script it can positively read. An imperative `resolve()`, a mode, a mana
 * rider, a structural construct, an unknown Op, a draw aimed anywhere but the
 * controller or the announced target, or any extra Op answers `false` and
 * leaves the line searchable.
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

function opIsDrawLeg(op: EffectOp): boolean {
    if (op.op !== "draw") return false;
    return op.player === "controller" || namesAnnouncedPlayer(op.player);
}

/** True only when the ability's whole script makes the controller or an
 *  announced target player draw. */
export function abilityIsDrawExchange(ability: ActivatedAbility): boolean {
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
    return effects.every(opIsDrawLeg);
}
