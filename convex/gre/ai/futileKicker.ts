/**
 * "Does this Kicker buy anything?" — a Bot-only cast-variant prune (issue
 * #6904), the sibling of the evoke prune (issue #4900, `evokeCastIsWasteful`).
 *
 * THE DECISION IT SERVES. CR 702.33a lets a caster pay a Kicker as an
 * additional cost. The Planeshift Battlemage cycle reads each Kicker only
 * through its own intervening-if ETB trigger ("if it was kicked with its {W}
 * kicker, destroy target artifact"). With no legal target the trigger is
 * removed from the stack the next time a player would receive priority
 * (CR 603.3d), so the Kicker's mana bought nothing: the kicked variant is a
 * strictly dominated child of the unkicked one, and the search can still pick
 * it or let it dilute every line's mean.
 *
 * IT FAILS CLOSED. A wrongly-pruned variant is invisible (the Bot never
 * considers a play); a wrongly-kept one costs a little search width. So a
 * Kicker is futile only when it is proven read by nothing else, from card
 * data alone:
 *
 *   * at least one triggered ability is gated on it — found by PROBING each
 *     trigger's decided `gate.onSelf` with a permanent that paid exactly that
 *     Kicker (the gate is a closure, `additionalCostPaidCondition`);
 *   * every such trigger declares a single `targetRequirement`, no modes, and
 *     has no legal target on the current board;
 *   * the rest of the definition never names the Kicker's id (spell effects,
 *     "enters with" counters, static abilities, a non-targeted trigger), and
 *     the card carries no imperative `resolve`.
 *
 * CR legality is unchanged: this constrains the Bot's move list, never a
 * human/server cast. Target legality is not re-checked between cast and
 * resolution (the board may change) — the same accepted gap as the evoke
 * prune.
 */
import type {
    CardDefinition,
    PermanentView,
    TriggeredAbility,
} from "../../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import type { KickerPayments } from "../kicker";

/** A triggered ability that declares ONE `targetRequirement`, no modes, and
 *  has no legal target on the current board — it will be removed from the
 *  stack doing nothing (CR 603.3d). The shared authority behind the evoke
 *  prune and the futile-Kicker prune. */
export function triggerHasNoLegalTarget(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    trigger: TriggeredAbility
): boolean {
    if (trigger.targetRequirement === undefined) return false;
    if (trigger.modes && trigger.modes.length > 0) return false;
    return (
        getLegalTargets(
            state,
            trigger.targetRequirement,
            targetingSourceFromCard(card, false),
            player.id
        ).length === 0
    );
}

/** True when `trigger`'s check-time gate opens for a permanent that paid
 *  exactly the Kicker `kickerId` and shuts for one that paid nothing. An
 *  ungated or unprobeable trigger answers false (fail closed). */
function triggerIsGatedOnKicker(
    trigger: TriggeredAbility,
    kickerId: string
): boolean {
    const decided = trigger.gate;
    if (!decided || !("onSelf" in decided)) return false;
    const gate = decided.onSelf;
    try {
        return (
            gate({ kickerPayments: { [kickerId]: 1 } } as PermanentView) &&
            !gate({} as PermanentView)
        );
    } catch {
        return false;
    }
}

function isFutileKicker(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    def: CardDefinition,
    kickerId: string
): boolean {
    if (def.resolve || def.resolveSteps || def.effect) return false;
    const triggers = def.triggeredAbilities ?? [];
    const gated = triggers.filter((t) => triggerIsGatedOnKicker(t, kickerId));
    if (gated.length === 0) return false;
    if (!gated.every((t) => triggerHasNoLegalTarget(state, player, card, t))) {
        return false;
    }
    // Anything else naming the id reads the Kicker (a spell effect, a
    // counters Kicker, a static ability, a non-targeted trigger).
    const rest = JSON.stringify({
        ...def,
        kickers: undefined,
        triggeredAbilities: triggers.filter((t) => !gated.includes(t)),
    });
    return !rest.includes(JSON.stringify(kickerId));
}

/** Bot-only: drop a Kicker-payment variant when any Kicker it pays is
 *  futile. The unkicked variant (`undefined`) always stays. */
export function withoutFutileKickerVariants(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    def: CardDefinition,
    variants: (KickerPayments | undefined)[]
): (KickerPayments | undefined)[] {
    if ((def.kickers ?? []).length === 0) return variants;
    const futile = new Map<string, boolean>();
    const isFutile = (id: string) => {
        let known = futile.get(id);
        if (known === undefined) {
            known = isFutileKicker(state, player, card, def, id);
            futile.set(id, known);
        }
        return known;
    };
    return variants.filter(
        (payments) =>
            !payments ||
            !Object.entries(payments).some(([id, n]) => n > 0 && isFutile(id))
    );
}
