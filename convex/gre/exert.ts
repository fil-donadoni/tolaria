// Exert (CR 701.43) — the single authority on what exerting a permanent DOES
// and on which declared attackers may be offered the choice.
//
// The mechanic has exactly two payment sites and they share this module so the
// rule is written once:
//   * the OPTIONAL ATTACK COST (CR 701.43d / 508.1g) — "You may exert this
//     creature as it attacks", chosen while attackers are being declared and
//     paid at `finalizeConfirmAttackers` (`convex/game.ts`);
//   * the ACTIVATION COST LEG (CR 602.1a) — `cost.exertThis`, Arena of Glory's
//     "{R}, {T}, Exert this land: …", paid at activation commit.
//
// Both call `exertPermanent`, so both stamp the SAME one-shot flag the untap
// step already consumes (`CardInstanceState.skipNextUntap`, CR 302.6 / 502.1 —
// shipped for Barl's Cage long before exert existed) and both emit the SAME
// `PERMANENT_EXERTED` event the linked "when you do" trigger listens to
// (CR 701.43d / 607.2h).

import type { CardInstanceState, GameState } from "./state";
import type {
    CardType,
    GameEvent,
    StaticMayExertAsAttacks,
} from "../cards/types";
import { tryGetDefinition } from "../cards";

/** CR 701.43a — "To exert a permanent, you choose to have it not untap during
 *  your next untap step." Stamps that choice on `card` and returns the
 *  `PERMANENT_EXERTED` event the caller queues (activation cost → the pending
 *  action-event queue) or batches (declare attackers → the same
 *  `collectTriggers` call as `ATTACKERS_DECLARED`, so both are APNAP-ordered
 *  together per CR 603.3b).
 *
 *  CR 701.43b — exerting an UNTAPPED permanent is legal, and so is exerting one
 *  that has already been exerted before its next untap step ("each effect
 *  causing it not to untap expires during the same untap step"). Both fall out
 *  of the flag being an idempotent boolean: this function never inspects
 *  `card.isTapped` and never rejects a re-exert.
 *
 *  CR 701.43c — "an object that isn't on the battlefield can't be exerted" is
 *  the caller's precondition: every call site holds a battlefield permanent. */
export function exertPermanent(
    card: CardInstanceState,
    asAttacks: boolean
): GameEvent {
    card.skipNextUntap = true;
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return {
        type: "PERMANENT_EXERTED",
        permanentId: card.id,
        controllerId: card.controllerId,
        permanentTypes: (def?.types ?? []) as ReadonlyArray<CardType>,
        permanentSubtypes: def?.subtypes ?? [],
        asAttacks,
    };
}

/** The `may-exert-as-attacks` static effect declared by `card`'s definition, or
 *  undefined when it declares none (CR 701.43d). The offer is self-scoped — the
 *  source IS the creature the choice is made for — so this is a definition read
 *  and never a battlefield scan, unlike the attack TAXES (`collectAttackManaTax`)
 *  a different permanent imposes. */
export function mayExertAsAttacks(
    card: CardInstanceState
): StaticMayExertAsAttacks | undefined {
    return mayExertAsAttacksById((card.card as { id?: string }).id ?? "");
}

/** The same read keyed by CARD DEFINITION ID, for the client: the projection
 *  strips `card` down to `{ id }` (`projectPublicState`), and the frontend's
 *  own `CardInstance` is a different type from `CardInstanceState`, so the
 *  affordance cannot call the instance form. Both forms answer from the SAME
 *  definition lookup, so the button the player sees and the offer the mutation
 *  accepts can never disagree. */
export function mayExertAsAttacksById(
    cardDefinitionId: string
): StaticMayExertAsAttacks | undefined {
    const def = tryGetDefinition(cardDefinitionId);
    return def?.staticEffects?.find(
        (e): e is StaticMayExertAsAttacks & typeof e =>
            e.kind === "may-exert-as-attacks"
    );
}

/** CR 508.1g — the declared attackers whose controller may still be offered the
 *  exert choice this combat, in `combat.attackerIds` order.
 *
 *  The SINGLE authority shared by the toggle mutation (which refuses an
 *  ineligible id), the bot's move enumeration and the client's affordance, so
 *  none of the three can disagree about what is offerable. An id already in
 *  `combat.exertedIds` stays in the list: the choice is a toggle until the
 *  declaration is confirmed, and CR 701.43b makes re-exerting legal anyway. */
export function exertableAttackerIds(state: GameState): string[] {
    const combat = state.combat;
    if (!combat || combat.confirmed) return [];
    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (!active) return [];
    return combat.attackerIds.filter((id) => {
        const card = active.battlefield.find((c) => c.id === id);
        return card !== undefined && mayExertAsAttacks(card) !== undefined;
    });
}

/** CR 508.1g/1j + 701.43a — pay the chosen optional attack costs for the
 *  declaration now being locked in: exert every id the active player picked in
 *  `combat.exertedIds` and return the `PERMANENT_EXERTED` events for the caller
 *  to batch with `ATTACKERS_DECLARED`.
 *
 *  Called from the ONE choke point every declare-attackers path funnels through
 *  (`emitAttackersDeclaredEvents`, `gre/phases.ts`) — the server mutation, the
 *  auto-pass auto-confirm, the bot's `applyMove` and the ISMCTS sandbox all
 *  reach it, so no path can declare an attack and silently skip the cost.
 *
 *  Ids that are no longer declared attackers, or no longer on the battlefield,
 *  are dropped: the fold in `confirmAttackers` (CR 508.1c/1d) may have removed
 *  an attacker after it was toggled, and a cost is never paid for a creature
 *  that is not attacking. Idempotent — a second call finds `skipNextUntap`
 *  already set and would merely re-emit, which is why the caller invokes it
 *  exactly once per declaration. */
export function payDeclaredExertCosts(state: GameState): GameEvent[] {
    const combat = state.combat;
    if (!combat?.exertedIds || combat.exertedIds.length === 0) return [];
    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (!active) return [];
    const declared = new Set(combat.attackerIds);
    const paid: string[] = [];
    const events: GameEvent[] = [];
    for (const id of combat.exertedIds) {
        if (!declared.has(id)) continue;
        const card = active.battlefield.find((c) => c.id === id);
        // CR 701.43c — only a permanent on the battlefield can be exerted.
        if (!card) continue;
        paid.push(id);
        events.push(exertPermanent(card, true));
    }
    combat.exertedIds = paid.length > 0 ? paid : undefined;
    return events;
}

/** CR 602.1a / 701.43a — pay an ability's `cost.exertThis` leg: exert the
 *  source and QUEUE the `PERMANENT_EXERTED` event on the pending action-event
 *  list, where `processPendingActionTriggers` picks it up alongside the
 *  activation's other events (the {T} leg's `PERMANENT_TAPPED`, say).
 *
 *  Returns true when this payment is what SET the flag — false when the source
 *  was already going to miss its next untap step. Only the reversible
 *  payment-tap path cares (a cancelled mana payment must un-exert exactly what
 *  it exerted and nothing else, CR 701.43b's "already been exerted" case); every
 *  other commit site ignores it. */
export function payExertActivationCost(
    state: GameState,
    card: CardInstanceState
): boolean {
    const alreadyExerted = card.skipNextUntap === true;
    const event = exertPermanent(card, false);
    state.pendingEvents = [...(state.pendingEvents ?? []), event];
    return !alreadyExerted;
}

/** CR 106.4 / 701.43b — reverse the exert a PAYMENT TAP paid, when that tap is
 *  what exerted the source (`exertedThisTap`). A permanent already not untapping
 *  for another reason — an earlier exert, Barl's Cage — keeps that effect:
 *  reversing this activation cannot undo a different one.
 *
 *  The queued `PERMANENT_EXERTED` event goes with it. Un-exerting while leaving
 *  the event in `state.pendingEvents` would fire the linked "when you do"
 *  trigger (CR 607.2h) for an exert that no longer happened — the same
 *  correspondence `discardPermanentTappedEvent` keeps for the {T} leg. The LAST
 *  matching event is the one this tap queued; an earlier exert of the same
 *  permanent still owns its own.
 *
 *  Shared by every reversal path: `untapSourceFromPayment`, `tapUntap`'s untap
 *  toggle, `rollbackPendingCast` and `untapForPayment` (`convex/game.ts`). */
export function restoreExertOnUntap(
    state: GameState,
    card: CardInstanceState
): void {
    if (!card.exertedThisTap) return;
    card.skipNextUntap = undefined;
    card.exertedThisTap = undefined;
    const queued = state.pendingEvents;
    if (!queued) return;
    for (let i = queued.length - 1; i >= 0; i--) {
        const e = queued[i];
        if (e.type === "PERMANENT_EXERTED" && e.permanentId === card.id) {
            const filtered = [...queued.slice(0, i), ...queued.slice(i + 1)];
            state.pendingEvents = filtered.length === 0 ? undefined : filtered;
            return;
        }
    }
}
