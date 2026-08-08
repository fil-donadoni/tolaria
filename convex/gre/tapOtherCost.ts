// Tap-other activation cost — the shared authority for the two shapes of
// "tap untapped permanents you control" that appear as an ACTIVATION COST
// (CR 602.1 / 118.8):
//
//   - **fixed cardinal** (`count`)      — "Tap three untapped white creatures
//                                          you control" (Hand of Justice).
//   - **total power** (`totalPower`)    — "Tap any number of untapped
//                                          creatures you control with total
//                                          power N or greater" (CR 702.122a,
//                                          Crew N).
//
// Both shapes share ONE pending picker (`PendingActivation.tapOtherChoice`),
// ONE mutation (`selectActivationCost`) and ONE commit gate
// (`tryAutoCommitPendingActivation`); only the "is the cost paid yet?" and
// "can the cost be paid at all?" predicates differ, and both live here so the
// server, the bot's move enumerator and the client affordance hint can never
// disagree.
//
// Deliberately NOT Vehicle-shaped: the totalPower leg is a generic
// "sum of a characteristic reaches a threshold" selection cost. Crew is
// currently its only user, which is why the per-candidate contribution is the
// crew contribution (see `crewPowerContribution` below).

import type { PermanentFilter } from "../cards/filters";

/** Declared shape of a `cost.tapOtherFilter` (see `ActivatedAbility.cost`).
 *  Exactly one of `count` / `totalPower` is meaningful; `totalPower` wins when
 *  both are set (a card should never declare both). */
export interface TapOtherCostSpec {
    filter: PermanentFilter;
    count?: number;
    totalPower?: number;
}

/** The minimum a candidate must expose to be weighed against a tap-other cost.
 *  `power` is the EFFECTIVE power (layer 7, CR 613.4) as seen by whoever is
 *  asking — the server passes `getEffectivePower`, the client passes the
 *  projected instance's own `power`. */
export interface TapOtherCandidate {
    id: string;
    power: number;
}

/** CR 702.122b — a creature "crews a Vehicle" when it's tapped to pay a crew
 *  cost. Its contribution to the total is its power (CR 702.122a), PLUS any
 *  "crews Vehicles as though its power were N greater" bonus the creature
 *  itself carries (Shorikai's Pilot token). The bonus is a characteristic of
 *  the CREATURE, not of the Vehicle, so it rides on the candidate. */
export function crewPowerContribution(power: number, crewBonus = 0): number {
    return power + crewBonus;
}

/** Sum of the candidates' contributions (CR 702.122a "total power"). */
export function totalTapOtherPower(
    candidates: readonly TapOtherCandidate[]
): number {
    return candidates.reduce((sum, c) => sum + c.power, 0);
}

/** True once `picked` fully pays the cost — the ONE completeness predicate.
 *  `count` mode: at least `count` picks. `totalPower` mode: the picks' summed
 *  power reaches the threshold (CR 702.122a "N or greater"); a player may tap
 *  MORE than strictly needed in paper, but since extra taps are never
 *  beneficial the payment auto-commits the moment the threshold is met. */
export function isTapOtherSelectionComplete(
    spec: Pick<TapOtherCostSpec, "count" | "totalPower">,
    picked: readonly TapOtherCandidate[]
): boolean {
    if (spec.totalPower !== undefined) {
        return totalTapOtherPower(picked) >= spec.totalPower;
    }
    return picked.length >= (spec.count ?? 0);
}

/** True when the whole candidate pool COULD pay the cost — the legality gate
 *  at announcement (CR 602.5b: an ability whose cost can't be paid can't be
 *  activated). Same predicate as completeness, applied to every candidate. */
export function canPayTapOtherCost(
    spec: Pick<TapOtherCostSpec, "count" | "totalPower">,
    candidates: readonly TapOtherCandidate[]
): boolean {
    return isTapOtherSelectionComplete(spec, candidates);
}

/** True when the candidate pool leaves the payer NO decision: the whole pool
 *  pays the cost and dropping its cheapest member does not (CR 601.2 — a
 *  "choice" with exactly one legal answer is not a choice). Callers use it to
 *  auto-commit instead of opening a picker whose only possible answer is
 *  forced, the same convention every other cost picker follows.
 *
 *  Dropping the CHEAPEST candidate is the general test for both shapes: under
 *  `count` any single removal leaves `length - 1`, so it reduces to
 *  `length === count`; under `totalPower` (CR 702.122a Crew N) removing the
 *  cheapest leaves the LARGEST possible proper subset, so if even that falls
 *  short no proper subset can pay and the pick is forced. */
export function isTapOtherPickForced(
    spec: Pick<TapOtherCostSpec, "count" | "totalPower">,
    candidates: readonly TapOtherCandidate[]
): boolean {
    if (!isTapOtherSelectionComplete(spec, candidates)) return false;
    if (candidates.length === 0) return true;
    let cheapestIdx = 0;
    for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].power < candidates[cheapestIdx].power)
            cheapestIdx = i;
    }
    const without = candidates.filter((_, i) => i !== cheapestIdx);
    return !isTapOtherSelectionComplete(spec, without);
}

/** Deterministic payment used by the bot's move applier (`applyMove`), which
 *  does not model the human's free choice of which permanents to tap.
 *  `count` mode: the first `count` candidates (historical behaviour).
 *  `totalPower` mode: greedily take the HIGHEST-power candidates first, so the
 *  bot crews with as few creatures as possible (the strictly better play —
 *  every untapped creature it keeps back can still attack or block). */
export function pickTapOtherPayment<T extends TapOtherCandidate>(
    spec: Pick<TapOtherCostSpec, "count" | "totalPower">,
    candidates: readonly T[]
): T[] {
    if (spec.totalPower === undefined) {
        return candidates.slice(0, spec.count ?? 0);
    }
    const byPowerDesc = [...candidates].sort((a, b) => b.power - a.power);
    const picks: T[] = [];
    let total = 0;
    for (const c of byPowerDesc) {
        if (total >= spec.totalPower) break;
        // A 0-power (or negative) creature can never move the total closer to
        // the threshold — tapping it is pure loss, so never pick one.
        if (c.power <= 0) continue;
        picks.push(c);
        total += c.power;
    }
    return total >= spec.totalPower ? picks : [];
}

/** Completeness check against a LIVE picker (`PendingActivation.tapOtherChoice`)
 *  rather than a candidate list — the shape the CLIENT has. The crew total is
 *  read off the server-maintained `pickedPower` mirror (the client cannot
 *  re-derive effective power + `crewPowerBonus` for itself), so this and the
 *  server's own recompute always agree. */
export function isTapOtherChoicePaid(toc: {
    count?: number;
    totalPower?: number;
    pickedIds: readonly string[];
    pickedPower?: number;
}): boolean {
    if (toc.totalPower !== undefined) {
        return (toc.pickedPower ?? 0) >= toc.totalPower;
    }
    return toc.pickedIds.length >= (toc.count ?? 0);
}

/** How much of the cost is still outstanding, for the payment banner's
 *  subtitle. `kind: "count"` → N more permanents; `kind: "power"` → N more
 *  total power. */
export function tapOtherRemaining(
    spec: Pick<TapOtherCostSpec, "count" | "totalPower">,
    pickedCount: number,
    pickedPower: number
): { kind: "count" | "power"; remaining: number } {
    if (spec.totalPower !== undefined) {
        return {
            kind: "power",
            remaining: Math.max(0, spec.totalPower - pickedPower),
        };
    }
    return {
        kind: "count",
        remaining: Math.max(0, (spec.count ?? 0) - pickedCount),
    };
}
