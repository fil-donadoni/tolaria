// Enlist (CR 702.154) — the optional attack cost: what the active player may
// choose while attackers are open, and paying what they chose. The keyword's
// trigger and the offer's rules are `cards/abilities/enlist.ts`.

import {
    enlistCandidates,
    enlistInstanceCount,
    type EnlistPair,
} from "../cards/abilities/enlist";
import type { GameEvent } from "../cards/types";
import { getEffectivePower } from "./layers";
import { tapPermanent } from "./state";
import type { GameState } from "./state/declarations";

/** CR 508.1g — whether `enlistedId` can pay an enlist cost of declared attacker
 *  `attackerId` right now. The authority the mutation refuses on. */
export function isLegalEnlistChoice(
    state: GameState,
    attackerId: string,
    enlistedId: string
): boolean {
    const combat = state.combat;
    if (!combat || combat.confirmed) return false;
    if (!combat.attackerIds.includes(attackerId)) return false;
    const active = state.players.find((p) => p.id === state.activePlayerId);
    const attacker = active?.battlefield.find((c) => c.id === attackerId);
    if (!active || !attacker) return false;
    if (enlistInstanceCount(attacker.staticAbilities) === 0) return false;
    return enlistCandidates(active.battlefield, combat.attackerIds).some(
        (c) => c.id === enlistedId
    );
}

/** CR 508.1g — flip one enlist choice while the declaration is open. Choosing a
 *  partner another attacker holds moves it (CR 701.26a: it can be tapped once).
 *  An attacker already holding one partner per instance gives up its oldest, so
 *  on the usual single instance a second click swaps (CR 702.154d). */
export function toggleEnlistChoice(
    state: GameState,
    attackerId: string,
    enlistedId: string
): void {
    const combat = state.combat;
    if (!combat || !isLegalEnlistChoice(state, attackerId, enlistedId)) {
        throw new Error("That creature can't be tapped to enlist");
    }
    const current = combat.enlists ?? [];
    const isSame = (pair: EnlistPair) =>
        pair.attackerId === attackerId && pair.enlistedId === enlistedId;
    if (current.some(isSame)) {
        const kept = current.filter((pair) => !isSame(pair));
        combat.enlists = kept.length > 0 ? kept : undefined;
        return;
    }
    const next = current.filter((pair) => pair.enlistedId !== enlistedId);
    const held = next.filter((pair) => pair.attackerId === attackerId);
    const attacker = state.players
        .find((p) => p.id === state.activePlayerId)
        ?.battlefield.find((c) => c.id === attackerId);
    const slots = enlistInstanceCount(attacker?.staticAbilities);
    const evicted = held.length >= slots ? held[0] : undefined;
    combat.enlists = [
        ...next.filter((pair) => pair !== evicted),
        { attackerId, enlistedId },
    ];
}

/** Drop the enlist choices the current selection no longer means: an attacker
 *  taken out of the declaration, or a partner now chosen to attack (CR 702.154a).
 *  Run at each selection change so the client and the Bot read a selection that
 *  means what it says, including while the declaration is parked on a tax. */
export function pruneEnlistChoices(
    combat: NonNullable<GameState["combat"]>
): void {
    if (!combat.enlists) return;
    const kept = combat.enlists.filter(
        (pair) =>
            combat.attackerIds.includes(pair.attackerId) &&
            !combat.attackerIds.includes(pair.enlistedId)
    );
    combat.enlists = kept.length > 0 ? kept : undefined;
}

/** CR 508.1g/1j + 702.154c — pay the enlist costs of the declaration being
 *  locked in: tap each chosen partner and return one `CREATURE_ENLISTED` per
 *  payment, for the caller to batch with `ATTACKERS_DECLARED`. `combat.enlists`
 *  is left holding only what was paid.
 *
 *  Called from `emitAttackersDeclaredEvents`, the one choke point every
 *  declare-attackers path reaches, after the attackers have tapped (CR 508.1f).
 *  A choice no longer payable is dropped rather than raising: partner tapped for
 *  mana toward an attack tax, or sacrificed to one. A declaration without that
 *  enlist was legal and has the same result, so nothing is lost by treating it
 *  as declined. `tapPermanent` refusing the tap (a replacement, CR 614) likewise
 *  pays nothing, and fires no "when you do". */
export function payDeclaredEnlistCosts(state: GameState): GameEvent[] {
    const combat = state.combat;
    if (!combat?.enlists) return [];
    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (!active) return [];
    const paid: EnlistPair[] = [];
    const events: GameEvent[] = [];
    for (const pair of combat.enlists) {
        if (!combat.attackerIds.includes(pair.attackerId)) continue;
        const attacker = active.battlefield.find(
            (c) => c.id === pair.attackerId
        );
        if (!attacker) continue;
        const paidByAttacker = paid.filter(
            (p) => p.attackerId === pair.attackerId
        ).length;
        if (paidByAttacker >= enlistInstanceCount(attacker.staticAbilities)) {
            continue;
        }
        const partner = enlistCandidates(
            active.battlefield,
            combat.attackerIds
        ).find((c) => c.id === pair.enlistedId);
        if (!partner || !tapPermanent(state, partner)) continue;
        paid.push(pair);
        events.push({
            type: "CREATURE_ENLISTED",
            attackerId: pair.attackerId,
            enlistedId: pair.enlistedId,
            controllerId: active.id,
            enlistedPower: getEffectivePower(state, partner),
        });
    }
    combat.enlists = paid.length > 0 ? paid : undefined;
    return events;
}
