// Collect evidence (CR 701.59) — the cost leg.
//
// CR 701.59a: To "collect evidence N" means to exile any number of cards from
//   your graveyard with total mana value N or greater.
// CR 701.59b: If a player is given the choice to collect evidence but is
//   unable to exile cards with total mana value N or greater from their
//   graveyard (usually because there aren't enough cards to do so) they can't
//   choose to collect evidence.
//
// Three surfaces, one `minTotalManaValue` picker mode — the same variable-size,
// threshold-on-the-selection shape escape's `minCardTypes` mode already has
// (CR 702.138a, Nethergoyf):
//
//  - an alternative cost's leg (`AlternativeCost.collectEvidence`), Detective's
//    Phoenix;
//  - CR 701.59c's optional additional cost (`KickerCost.collectEvidence`,
//    `keyword: "collect-evidence"`), whose linked "if evidence was collected"
//    reads the entry's payment record. Both park on the cast's picker
//    (`PendingCast.exileFromGraveyardChoice`) and pay at the Cast Commit;
//  - an activation cost (`cost.exileFromGraveyard.minTotalManaValue`), which
//    parks on `PendingActivation.exileFromGraveyardChoice` and pays at the
//    activation commit.
//
// Nothing here moves a card.
//
// Every function here is typed on the STRUCTURAL card shape it reads (the
// definition id), so the client's projected graveyard — a public zone, CR
// 400.2 — prices the leg through the very same code (ADR 0074).

import type { AlternativeCost } from "../cards/types";
import { tryGetDefinition } from "../cards/registry";
import { manaValue } from "./constants";
import type { PendingCast } from "./state/declarations";

type GraveyardCard = { id: string; card: { id?: string } };

/** CR 202.3 — the mana value of a card in a graveyard: its printed mana cost,
 *  `{X}` as 0 (CR 202.3e). 0 for a card whose definition is unknown (a
 *  synthetic fixture), which can never pay toward a threshold. */
export function graveyardCardManaValue(card: {
    card: { id?: string };
}): number {
    const id = card.card.id;
    return manaValue(id ? tryGetDefinition(id)?.manaCost : undefined);
}

/** CR 701.59a — the summed mana value of `cards`. */
export function totalManaValue(
    cards: readonly { card: { id?: string } }[]
): number {
    return cards.reduce((acc, c) => acc + graveyardCardManaValue(c), 0);
}

/** CR 701.59b — can the payer collect evidence `n` from `graveyard` right now?
 *  The cast card itself (`excludeInstanceId`) never pays for its own cost: CR
 *  601.2a moves it to the stack before costs are paid (CR 601.2h), and a
 *  Detective's Phoenix cast FROM the graveyard is sitting in it at
 *  announcement. */
export function canCollectEvidence(
    graveyard: readonly GraveyardCard[],
    n: number,
    /** Absent on an activation: an activated ability has no cast card. */
    excludeInstanceId?: string
): boolean {
    return (
        totalManaValue(graveyard.filter((c) => c.id !== excludeInstanceId)) >= n
    );
}

/** CR 701.59a — is `picked` a legal payment of collect evidence `n`? At least
 *  one card (a threshold of 0 would still be a choice to exile "any number",
 *  and no printed N is 0) whose summed mana value is ≥ `n`. */
export function collectEvidenceSatisfied(
    picked: readonly { card: { id?: string } }[],
    n: number
): boolean {
    return picked.length >= 1 && totalManaValue(picked) >= n;
}

/** CR 701.59b — is an activation's `cost.exileFromGraveyard` leg a collect
 *  evidence its payer cannot pay? `false` for every other shape of the leg, whose
 *  count and filter its own callers price. The one gate behind the announcement,
 *  the Bot's enumerator and the client's hint; typed on the structural player so
 *  the projected view is priced by the same code (ADR 0074). */
export function activationEvidenceUnpayable(
    leg: { minTotalManaValue?: number } | undefined,
    payer: { graveyard?: readonly GraveyardCard[] } | undefined
): boolean {
    const n = leg?.minTotalManaValue;
    return n !== undefined && !canCollectEvidence(payer?.graveyard ?? [], n);
}

/** CR 701.59a — the cheapest covering pick of a collect evidence `n`, walking
 *  `candidates` in their given order (the caller's cheapest-first), or `null`
 *  when they cannot reach it. A zero-mana-value card adds nothing toward the
 *  threshold and is never exiled for it. Shared by the cast and activation
 *  answers, so both spend the graveyard the same way. */
export function manaValueCoverPick(
    candidates: readonly { id: string; manaValue: number }[],
    n: number
): string[] | null {
    const picked: string[] = [];
    let total = 0;
    for (const { id, manaValue: mv } of candidates) {
        if (total >= n) break;
        if (mv <= 0) continue;
        picked.push(id);
        total += mv;
    }
    return total >= n && picked.length > 0 ? picked : null;
}

/** Fold an alternative cost's COLLECT EVIDENCE leg (CR 701.59a) into the
 *  cast's graveyard-exile picker as its `minTotalManaValue` mode, UNPICKED —
 *  the payer always chooses which cards are exiled, even when only one set
 *  would do. Returns `existing` untouched when the cost has no such leg.
 *  Throws when the leg cannot be paid (CR 701.59b; affordability is gated
 *  upstream by `canPayAlternativeCost`, so this is defence in depth) or when
 *  the picker slot is already taken: no shipped card pairs this leg with
 *  another graveyard exile cost (a flashback / escape / delve exile, or an
 *  alternative cost's positional graveyard leg). */
export function withCollectEvidenceExile(
    graveyard: readonly GraveyardCard[],
    altCost: Pick<AlternativeCost, "collectEvidence"> | undefined,
    castInstanceId: string,
    existing: PendingCast["exileFromGraveyardChoice"]
): PendingCast["exileFromGraveyardChoice"] {
    const n = altCost?.collectEvidence;
    if (n === undefined) return existing;
    if (!canCollectEvidence(graveyard, n, castInstanceId)) {
        throw new Error(
            `Can't collect evidence ${n}: not enough total mana value in your graveyard`
        );
    }
    if (existing) throw new Error("These costs cannot be paid together");
    return {
        count: 1,
        minTotalManaValue: n,
        excludeInstanceId: castInstanceId,
    };
}
