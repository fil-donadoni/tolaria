/**
 * "Is this activated ability a denial EXCHANGE?" — a static property of an
 * Effect Script, read by the search's below-the-root sacrifice prune
 * (issue #5431).
 *
 * The shape: the ability's cost gives up a permanent (CR 701.21a — the
 * sacrifice is a cost, CR 118.1) and its WHOLE script imposes a turn-scoped
 * restriction on an announced target player — "Sacrifice this creature: Target
 * player can't play lands this turn" (CR 305.1, CR 101.2). Such an activation
 * trades a permanent for a denial that expires with the turn; it creates no
 * card, no mana, no damage and no life, and the body it spends is worth more
 * standing. The search still opens its variants (one per victim and target) at
 * every node below a cast, where they outnumber `pass` and drag the cast edge
 * under it.
 *
 * FAILS CLOSED, like `abilityIsDrainExchange`: answers `true` only for a script
 * it can positively read. An imperative `resolve()`, a mode, a mana rider, a
 * structural construct, an unknown Op, a restriction aimed anywhere but the
 * announced target, or any extra Op answers `false` and leaves the line
 * searchable.
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

function opIsDenialLeg(op: EffectOp): boolean {
    if (
        op.op === "restrictLandPlay" ||
        op.op === "restrictCasting" ||
        op.op === "restrictActivation"
    ) {
        return namesAnnouncedPlayer(op.player);
    }
    return false;
}

/** True only when the ability's whole script restricts an announced target
 *  player for the turn. */
export function abilityIsDenialExchange(ability: ActivatedAbility): boolean {
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
    return effects.every(opIsDenialLeg);
}
