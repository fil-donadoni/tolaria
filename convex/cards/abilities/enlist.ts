// Enlist (CR 702.154).
//
// CR 702.154a — "Enlist represents a static ability and a triggered ability.
//               Enlist means 'As this creature attacks, you may tap up to one
//               untapped creature you control that you didn't choose to attack
//               with and that either has haste or has been under your control
//               continuously since this turn began. When you do, this creature
//               gets +X/+0 until end of turn, where X is the tapped creature's
//               power.'"
// CR 702.154b — the static half is an optional cost to attack (CR 508.1g), and
//               the trigger is linked to it (CR 607.2h).
// CR 702.154d — "Multiple instances of enlist on a single creature function
//               independently. The triggered ability represented by each
//               instance of enlist triggers only once and only for the cost
//               associated with that enlist ability."
//
// This module holds what the server and the client must agree on: who can be
// tapped and how many creatures an attacker can tap. It reads no game state, so
// the client's panel asks the same question the mutation refuses on. Paying the
// cost is `gre/enlist.ts`.
//
// Enlist reaches a permanent printed or granted, so the trigger comes from the
// LIVE layer-6 multiset (`liveKeywordTriggers.ts`), which has already applied any
// loss of abilities (CR 613.1f). One trigger per PERMANENT is enough for CR
// 702.154d: every paid cost raises its own CREATURE_ENLISTED event, so each
// payment fires exactly once however many instances the creature has.

import type { TriggeredAbility } from "../types";

export const ENLIST_KEYWORD = "enlist";
export const ENLIST_TRIGGER_ID = "enlist";

/** The fields of a permanent the CR 702.154a offer reads. A structural subset,
 *  because the server's `CardInstanceState` and the client's `CardInstance` are
 *  different types holding the same projected fields. */
export interface EnlistCandidateView {
    id: string;
    types?: readonly string[];
    isTapped: boolean;
    isSummoningSick?: boolean;
    staticAbilities?: readonly string[];
}

/** One paid (or chosen) enlist cost: `attackerId` enlists `enlistedId`
 *  (CR 702.154c). */
export interface EnlistPair {
    attackerId: string;
    enlistedId: string;
}

/** CR 702.154a — the X reads the tapped creature's power as the trigger
 *  resolves (CR 608.2h): `$event.enlistedPower` is the live value while it is on
 *  the battlefield and its last known value after (`cards/eventFields.ts`).
 *
 *  The trigger names no target (CR 115.1), so shroud and hexproof on the attacker
 *  do not stop it, and it can be responded to like any other (CR 603.3). */
export const ENLIST_TRIGGER: TriggeredAbility = {
    id: ENLIST_TRIGGER_ID,
    oracleText:
        "Enlist (When you tap a creature for this creature's enlist cost, this creature gets +X/+0 until end of turn, where X is the tapped creature's power.)",
    event: "CREATURE_ENLISTED",
    matches: (event, self) =>
        event.type === "CREATURE_ENLISTED" && event.attackerId === self.id,
    effects: [
        {
            op: "pump",
            target: { ref: "$source" },
            power: { ref: "$event.enlistedPower" },
            toughness: 0,
            duration: { phase: "end-of-turn" },
        },
    ],
};

/** CR 702.154d — how many enlist costs this creature can pay: one per instance
 *  in the layer-6 multiset. */
export function enlistInstanceCount(
    staticAbilities: ReadonlyArray<string> | undefined
): number {
    return (
        staticAbilities?.filter((keyword) => keyword === ENLIST_KEYWORD)
            .length ?? 0
    );
}

/** CR 702.154a — the creatures on `battlefield` that could pay an enlist cost:
 *  untapped creatures not chosen to attack, with haste or free of summoning
 *  sickness. The same read as `isTapLockedBySummoningSickness`, whose flag holds
 *  "under your control continuously since this turn began" (CR 302.6) because an
 *  attack is always declared in its controller's own turn.
 *
 *  `attackerIds` also covers CR 702.154c, a creature enlisting itself: it is
 *  chosen to attack, so it is never a candidate. */
export function enlistCandidates<T extends EnlistCandidateView>(
    battlefield: readonly T[],
    attackerIds: readonly string[]
): T[] {
    return battlefield.filter(
        (card) =>
            card.types?.includes("Creature") === true &&
            !card.isTapped &&
            !attackerIds.includes(card.id) &&
            (!card.isSummoningSick || card.staticAbilities?.includes("haste"))
    );
}

/** CR 508.1g — every way `slots` (one attacker id per enlist instance) can be
 *  paid from `partnerIds`, each partner tapped at most once (CR 701.26a: only an
 *  untapped permanent can be tapped). The all-declines answer is left out: the
 *  caller already holds that declaration. Two slots of ONE attacker are the same
 *  choice in either order, so a later slot only takes a later partner. */
export function enlistAssignments(
    slots: readonly string[],
    partnerIds: readonly string[]
): EnlistPair[][] {
    const results: EnlistPair[][] = [];
    const walk = (
        index: number,
        chosen: EnlistPair[],
        lastPartnerOf: ReadonlyMap<string, number>
    ): void => {
        if (index === slots.length) {
            if (chosen.length > 0) results.push(chosen);
            return;
        }
        const attackerId = slots[index];
        // Declining ends this attacker's picks, so one answer has one spelling.
        walk(
            index + 1,
            chosen,
            new Map(lastPartnerOf).set(attackerId, partnerIds.length)
        );
        const from = (lastPartnerOf.get(attackerId) ?? -1) + 1;
        for (let p = from; p < partnerIds.length; p++) {
            const enlistedId = partnerIds[p];
            if (chosen.some((pair) => pair.enlistedId === enlistedId)) continue;
            walk(
                index + 1,
                [...chosen, { attackerId, enlistedId }],
                new Map(lastPartnerOf).set(attackerId, p)
            );
        }
    };
    walk(0, [], new Map());
    return results;
}
