/**
 * "Is this activated ability a discard EXCHANGE?" — a static property of an
 * Effect Script, read by the search's below-the-root sacrifice prune
 * (issue #4276).
 *
 * The shape: the ability's cost gives up a permanent (CR 701.21a — the
 * sacrifice is a cost, CR 118.1) and its WHOLE script makes an announced
 * target player discard: the `choice` of `kind: "discard-hand"` that lets the
 * target pick the cards, then the `discard` of that binding (CR 701.9a,
 * "Sacrifice a creature: Target player discards two cards"), or the
 * `discardAtRandom` of the announced player (CR 701.9b, "Target opponent
 * discards a card at random", issue #4285). Such an
 * activation trades a permanent for cards out of the opponent's hand: it
 * creates no card, no mana, no life and no damage for its controller, and the
 * payoff is a hand the opponent may have already emptied. The search still
 * opens its variants (one per victim and target) at every node below a cast,
 * where they outnumber `pass` and drag the cast edge under it.
 *
 * FAILS CLOSED, like `abilityIsRemovalExchange`: answers `true` only for a
 * script it can positively read. An imperative `resolve()`, a mode, a mana
 * rider, a structural construct, an unknown Op, a discard the controller
 * makes themselves, or any extra Op answers `false` and leaves the line
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

function opMakesTargetDiscard(op: EffectOp): boolean {
    if (op.op === "choice") {
        return (
            op.kind === "discard-hand" &&
            namesAnnouncedPlayer((op as { player?: unknown }).player)
        );
    }
    if (op.op === "discard" || op.op === "discardAtRandom") {
        return namesAnnouncedPlayer((op as { player?: unknown }).player);
    }
    return false;
}

/** True only when the ability's whole script makes an announced target player
 *  discard. */
export function abilityIsDiscardExchange(ability: ActivatedAbility): boolean {
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
    // A discard needs a discarding Op itself; a lone choice does nothing.
    if (
        !effects.some(
            (op) => op.op === "discard" || op.op === "discardAtRandom"
        )
    )
        return false;
    return effects.every(opMakesTargetDiscard);
}
