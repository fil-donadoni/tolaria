// Exhaust (CR 702.177) — the single authority on whether an exhaust ability
// can still be activated and on spending it.
//
// CR 702.177a: "Exhaust — [Cost]: [Effect]" means "[Cost]: [Effect]. Activate
// only once." The gate is per ABILITY and per OBJECT: it lives on
// `CardInstanceState.exhaustedAbilities`, which survives turns and untaps and is
// cleared on re-entry (CR 400.7), so it is not the per-turn `activationsThisTurn`
// tally `oncePerTurn` reads.
//
// Read by every surface that decides whether an activation is on offer: the
// server gate, the Bot enumerator and the client hint (through
// `activationPreconditionViolation`), and the mana-ability readers
// (`getManaTapOptionsDetailed`, `getActivatedManaAbility`).

import type { ActivatedAbility } from "../cards/types";
import type { CardInstanceState } from "./state/declarations";

/** What the gate reads off the source. Structural, so the engine's
 *  `CardInstanceState`, the projected client card and a `PermanentView` all
 *  satisfy it. */
type ExhaustSource = {
    readonly exhaustedAbilities?: readonly string[];
    readonly exhaustedThisTap?: string;
    readonly isTapped?: boolean;
};

/** CR 702.177a — whether `ability` may still be activated as far as exhaust is
 *  concerned: always, unless it is an exhaust ability this object has already
 *  activated.
 *
 *  A for-mana tap that is still reversible (`exhaustedThisTap`, CR 106.4) keeps
 *  its ability readable while the source stays tapped, so the undo paths can
 *  resolve what they are reversing. It cannot be activated in that window: the
 *  ability costs {T} and its source is tapped. */
export function exhaustGateOpen(
    ability: Pick<ActivatedAbility, "id" | "exhaust">,
    source: ExhaustSource
): boolean {
    if (ability.exhaust !== true) return true;
    if (!source.exhaustedAbilities?.includes(ability.id)) return true;
    return source.isTapped === true && source.exhaustedThisTap === ability.id;
}

/** CR 702.177a — spend `ability` on `card`. No-op for an ability without
 *  exhaust. */
export function recordExhaust(
    card: CardInstanceState,
    ability: Pick<ActivatedAbility, "id" | "exhaust"> | null | undefined
): void {
    if (ability?.exhaust !== true) return;
    const spent = card.exhaustedAbilities ?? [];
    if (spent.includes(ability.id)) return;
    card.exhaustedAbilities = [...spent, ability.id];
}

/** CR 605.1a / 702.177a — spend the exhaust mana ability a for-mana TAP
 *  activated, remembering it so reversing that tap gives it back. Always
 *  reassigns the record: a later tap through another ability must not leave an
 *  earlier activation reversible. */
export function recordExhaustOnManaTap(
    card: CardInstanceState,
    ability: ActivatedAbility | null | undefined
): void {
    card.exhaustedThisTap = undefined;
    if (ability?.exhaust !== true) return;
    recordExhaust(card, ability);
    card.exhaustedThisTap = ability.id;
}

/** CR 106.4 — reversing a for-mana tap undoes the whole activation, the spent
 *  exhaust included. Called by every reversal path beside
 *  `restoreExertOnUntap`. */
export function restoreExhaustOnUntap(card: CardInstanceState): void {
    const id = card.exhaustedThisTap;
    if (id === undefined) return;
    card.exhaustedThisTap = undefined;
    const left = (card.exhaustedAbilities ?? []).filter((a) => a !== id);
    card.exhaustedAbilities = left.length > 0 ? left : undefined;
}
