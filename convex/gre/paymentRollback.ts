// CR 733.1 / 601.2 / 602.2 — reversing a mana payment that never committed.
// A cast or activation announced but not yet put on the stack is rolled back
// (cancelled, or abandoned by passing priority): every mana-ability tap it made
// is undone, cost legs included. Moved out of `convex/game.ts` (issue
// #9001) so the auth-free decline cores (`owedInputDeclines.ts`) a server-side
// caller with no `ctx.auth` runs can reach the same reversal the public
// mutations use; `game.ts` re-exports the names its tests import.
import { getDefinition } from "../cards/registry";
import type { ActivatedAbility, Color, ManaCost } from "../cards/types";
import { clearDeclinedExileRoute } from "./castCost";
import {
    getActivatedManaAbility,
    getActivatedManaColor,
    getActivatedManaRestriction,
    getBasicLandMana,
    getFixedManaAmount,
} from "./constants";
import { restoreExertOnUntap } from "./exert";
import { recomposeLayer6ForInstance } from "./layer6";
import { getPlayer } from "./lookup";
import { reverseManaAbilityEffectsOnUntap } from "./manaAbilityEffects";
import { MANA_COLORS } from "./manaColors";
import {
    applyKeywordCounterGrant,
    discardPermanentTappedEvent,
    hasAnyManaRider,
    manaRidersForAbility,
    reverseRestrictedManaFromPool,
    type CardInstanceState,
    type GameState,
    type PlayerState,
} from "./state";

/** CR 106.4 / 118.3 — reverses the counters a for-mana tap removed from its own
 *  source, when that tap is undone to refund unspent mana in the same priority
 *  window. Covers BOTH counter-cost shapes, which share the
 *  `manaCounterRemoval` snapshot: the SCALING cost of a Mana Battery
 *  (`manaChoiceRemovesCounters`) and the FIXED `cost.removeCounter` leg of a
 *  depletion land.
 *
 *  The single authority for the restore, over all FIVE reversal sites — three
 *  on the activation side (`untapSourceFromPayment`, `tapUntap`'s choice
 *  branch, `tapUntap`'s fixed branch) and two on the cast side
 *  (`untapForPayment`, `rollbackPendingCast`). Before this helper existed
 *  there were two hand-rolled copies and three holes, and each hole burns the
 *  counter permanently: the land yields its mana once instead of twice, for a
 *  cast that never happened. The cast-side pair is the same
 *  reversal-symmetry class #3214 and #3354 already fixed for the exert and
 *  life/mana legs.
 *
 *  CR 122.1b (issue #1194) — a KEYWORD counter coming back re-grants its
 *  keyword, and the layer-6 recompose makes it visible before the next SBA
 *  pass, mirroring exactly what `payRemoveCounterCost` splices out when the
 *  cost is paid. That is why this takes `state`: a restore that put the
 *  counter back without the grant would leave a permanent holding an
 *  indestructible counter and not indestructible. No-op when the tap removed
 *  no counters. */
export function restoreManaCounterRemovalOnUntap(
    state: GameState,
    card: CardInstanceState
): void {
    if (!card.manaCounterRemoval) return;
    const { type, count } = card.manaCounterRemoval;
    const next = { ...(card.counters ?? {}) };
    next[type] = (next[type] ?? 0) + count;
    card.counters = next;
    card.manaCounterRemoval = undefined;
    applyKeywordCounterGrant(state, card, type);
    recomposeLayer6ForInstance(state, card);
}

/** CR 106.4 / 605.1a — refund the mana recorded by
 *  {@link applyManaAbilityManaCost} when a tap-for-mana is reversed before its
 *  produced mana is spent (the `tapUntap` untap toggle, `untapForPayment`).
 *  Symmetric with `restoreLifePaidOnUntap` and the `chosenMana` /
 *  charge-counter refunds: an undone activation must undo its COST too, or the
 *  toggle is a mana burner. No-op when the ability had no mana cost. */
export function restoreManaPaidOnUntap(
    player: PlayerState,
    card: CardInstanceState
): void {
    const paid = card.manaPaidThisTap;
    if (!paid) return;
    for (const [color, amount] of Object.entries(paid)) {
        if (color === "X" || typeof amount !== "number" || amount <= 0)
            continue;
        const key = color as keyof typeof player.manaPool;
        player.manaPool[key] = (player.manaPool[key] ?? 0) + amount;
    }
    card.manaPaidThisTap = undefined;
}

/** CR 106.4 / 605.1a — restore the life recorded by `recordLifePaidOnTap` when
 *  a tap-for-mana is reversed before its mana is spent (the `tapUntap` untap
 *  toggle or `untapForPayment`). Symmetric with the mana / charge-counter
 *  refund. Unlike City of Brass, whose becomes-tapped TRIGGER goes on the stack
 *  and blocks the reversal (`tapTriggerCommitted`), painland-style inline riders
 *  resolve with no stack, so the tap — life ping included — stays reversible.
 *  No-op when the source paid no life. Shared by both untap paths. */
export function restoreLifePaidOnUntap(
    player: PlayerState,
    card: CardInstanceState
): void {
    if (!card.lifePaidThisTap) return;
    player.life += card.lifePaidThisTap;
    card.lifePaidThisTap = undefined;
}

/** CR 106.6 (issue #1559 review) — resolves the activated mana ability that
 *  ACTUALLY produced `refund` (a `card.chosenMana` snapshot) by matching its
 *  exact shape against every one of the card's non-useStack mana abilities'
 *  declared output. `getActivatedManaAbility` returns only the FIRST such
 *  ability on the card, which is wrong when the chosen output came from a
 *  SECOND, distinct ability (Delighted Halfling: "{T}: Add {C}." is found
 *  first, but the actual restricted deposit can come from the separate
 *  legendary-spell ability) — reversing against the wrong ability corrupts
 *  state (decrementing a pool that was never credited while the real deposit
 *  sits untouched in `restrictedMana`). Correct as long as no two mana
 *  abilities on the same card share an output shape while differing in
 *  restriction or rider — enforced catalogue-wide by
 *  `manaAbilityOutputAmbiguity.test.ts` (agreeing pairs, Quirion Elves, are
 *  fine: either resolves to the same reversal). Falls back to `fallback` (the card's single/first
 *  ability) when nothing matches — the previously-only-supported single-mana-
 *  ability shape. Shared by every untap/refund site that reverses a
 *  `chosenMana` snapshot: `tapUntap`'s untap toggle, `untapSourceFromPayment`,
 *  `untapForPayment`'s toggle, and `rollbackPendingCast`'s bulk undo. */
function resolveManaAbilityByOutput(
    card: CardInstanceState,
    refund: ManaCost,
    fallback: ActivatedAbility | null
): ActivatedAbility | null {
    const manaShapesEqual = (a: ManaCost, b: ManaCost): boolean =>
        MANA_COLORS.every((c) => (a[c] ?? 0) === (b[c] ?? 0));
    const cardDef = getDefinition(card.card.id as string);
    return (
        cardDef.activatedAbilities?.find(
            (a) =>
                !a.useStack &&
                (a.manaChoices?.some((m) => manaShapesEqual(m, refund)) ??
                    (a.manaProduced
                        ? manaShapesEqual(a.manaProduced, refund)
                        : false))
        ) ?? fallback
    );
}

/** CR 106.4/106.6 (issue #1559 review) — refunds mana a payment tap produced,
 *  restriction-aware: reverses the parallel `restrictedMana` deposit (with its
 *  rider) when the producing ability was restricted, instead of always
 *  assuming the fungible `manaPool` like every one of these sites used to. The
 *  `card.chosenMana` half of the split below — refunds a manaChoices-based
 *  ability's snapshotted output, resolving which ability actually produced it
 *  via `resolveManaAbilityByOutput` (more than one ability can be in play on
 *  the same card — Delighted Halfling). No-op if `chosenMana` is unset (the
 *  caller is expected to check first, matching each call site's own "which
 *  branch applies" logic — a bulk rollback vs. a single-tap undo differ on
 *  what to do in the OTHER (fixed-ability) branch, so that half is kept
 *  separate below as `refundFixedManaOutput` rather than folded in here). */
export function refundChosenManaOutput(
    player: PlayerState,
    card: CardInstanceState
): void {
    const refund = card.chosenMana;
    if (!refund) return;
    const producingAbility = resolveManaAbilityByOutput(
        card,
        refund,
        getActivatedManaAbility(card)
    );
    const restriction = producingAbility?.manaRestriction;
    const riders = manaRidersForAbility(producingAbility);
    // CR 106.6 (issue #3354) — symmetric with `depositTappedMana`: a rider
    // banked the mana in the parallel pool even without a restriction, so the
    // reversal must look for it there or the refund silently untaps for free.
    const tagged = restriction !== undefined || hasAnyManaRider(riders);
    for (const [color, amount] of Object.entries(refund)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            if (tagged) {
                reverseRestrictedManaFromPool(
                    player,
                    color,
                    amount,
                    restriction,
                    riders
                );
            } else {
                player.manaPool[color] = Math.max(
                    0,
                    (player.manaPool[color] ?? 0) - amount
                );
            }
        }
    }
    card.chosenMana = undefined;
}

/** The FIXED-ability sibling of {@link refundChosenManaOutput} — refunds a
 *  single-mana-ability card (a land / Mishra's Workshop) whose output was
 *  never snapshotted onto `chosenMana` (the non-dynamic, non-substituted
 *  case). `manaColor` is the caller's already-resolved
 *  `getBasicLandMana ?? getActivatedManaColor` result — callers differ on
 *  what to do when that's absent (throw vs. silently skip), so this assumes
 *  a valid color was already found. */
export function refundFixedManaOutput(
    player: PlayerState,
    card: CardInstanceState,
    manaColor: Color
): void {
    const amount = getFixedManaAmount(card, manaColor);
    const restriction = getActivatedManaRestriction(card);
    // CR 106.6 (issue #3354) — the fixed-output twin of the split in
    // `refundChosenManaOutput`: an ability whose mana carries a rider banked
    // into the parallel pool whether or not it also carried a restriction.
    const riders = manaRidersForAbility(getActivatedManaAbility(card));
    if (restriction || hasAnyManaRider(riders)) {
        reverseRestrictedManaFromPool(
            player,
            manaColor,
            amount,
            restriction ?? undefined,
            riders
        );
    } else {
        player.manaPool[manaColor] = Math.max(
            0,
            (player.manaPool[manaColor] ?? 0) - amount
        );
    }
}

/** CR 605.4 / 106.4 — reversing a for-mana tap undoes the whole mana ability,
 *  so refund the extra mana a Wild-Growth-style triggered mana ability added on
 *  this tap (`tapBonusMana`) and clear the record. Without this the bonus stays
 *  floating after the source untaps — the tap → +2 / untap → −1 infinite-mana
 *  leak. Symmetric with the `chosenMana` / `lifePaidThisTap` refunds. No-op when
 *  the tap added no bonus. */
export function refundTapBonusMana(
    player: PlayerState,
    card: CardInstanceState
): void {
    if (!card.tapBonusMana) return;
    for (const [color, amount] of Object.entries(card.tapBonusMana)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            player.manaPool[color] = Math.max(
                0,
                (player.manaPool[color] ?? 0) - amount
            );
        }
    }
    card.tapBonusMana = undefined;
}

/** Reverses a single tap recorded in `tappedLandIds` — refunds the mana and
 *  untaps the source. Shared by untapForPayment and untapForActivationPayment. */
export function untapSourceFromPayment(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): void {
    discardPermanentTappedEvent(state, card.id);
    refundTapBonusMana(player, card);
    // CR 106.6 (issue #1559 review) — restriction-aware refund: reverses the
    // parallel `restrictedMana` deposit (with its rider) instead of always
    // assuming the fungible pool.
    if (card.chosenMana) {
        refundChosenManaOutput(player, card);
    } else {
        const manaColor = getBasicLandMana(card) ?? getActivatedManaColor(card);
        if (!manaColor) throw new Error("Card does not produce mana");
        refundFixedManaOutput(player, card, manaColor);
    }
    // CR 106.4 / 118.3 — restore the counters removed to pay a Mana Battery's scaling
    // cost or a depletion land's fixed `cost.removeCounter` leg, when the
    // payment tap is reversed.
    restoreManaCounterRemovalOnUntap(state, card);
    // CR 106.4 / 605.1a — reversing this payment tap undoes the whole mana
    // ability, so restore the life its inline riders took (painland ping,
    // Ancient Tomb, Mana Confluence). Symmetric with the mana / counter refund
    // above.
    restoreLifePaidOnUntap(player, card);
    // CR 106.4 / 701.43b — and the exert its cost leg paid (Arena of Glory).
    restoreExertOnUntap(state, card);
    reverseManaAbilityEffectsOnUntap(card);
    // CR 106.4 / 601.2f — and the mana its own activation cost took (Chromatic
    // Star's {1}). Same reversal, cost side.
    restoreManaPaidOnUntap(player, card);
    card.isTapped = false;
}

/** Roll back the in-progress spell payment: untap every land tapped so far,
 *  return their mana to nothing, and clear `pendingCast`. Sacrificed sources
 *  (Black Lotus) cannot be un-sacrificed, so their mana contribution is left in
 *  the pool — the empty-pool step at phase end drains it. Mirrors the rollback
 *  the player triggers explicitly via `cancelCast`. */
export function rollbackPendingCast(state: GameState): void {
    if (!state.pendingCast) return;
    const player = getPlayer(state, state.pendingCast.playerId);
    reversePaymentTaps(state, player, state.pendingCast.tappedLandIds);
    // CR 702.132a — the assistant's mana window was opened by this cast, so
    // cancelling it reverses their taps too. Their payment needs no refund: it is
    // spent only when the cast commits.
    const assist = state.pendingCast.assistChoice;
    if (assist?.assistantId) {
        reversePaymentTaps(
            state,
            getPlayer(state, assist.assistantId),
            assist.assistantTappedIds ?? []
        );
    }
    // CR 702.126 — Improvise: undo every artifact tapped toward this cast's
    // generic cost. Unlike land taps, these never touched the mana pool, so
    // there's nothing to refund — just untap and drop the queued tap event.
    // `manaCost` itself is discarded below with the whole pendingCast, so the
    // generic reduction it carried needs no separate restoration.
    for (const cardId of state.pendingCast.improviseTappedArtifactIds ?? []) {
        discardPermanentTappedEvent(state, cardId);
        const card = player.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.isTapped = false;
    }
    clearDeclinedExileRoute(state, state.pendingCast.cardInstanceId);
    state.pendingCast = undefined;
}

/** Reverses the mana-ability taps a cast's payment made on `player`'s sources:
 *  untap, undo the tap's side effects, take the produced mana back. */
function reversePaymentTaps(
    state: GameState,
    player: PlayerState,
    cardIds: readonly string[]
): void {
    for (const cardId of cardIds) {
        discardPermanentTappedEvent(state, cardId);
        const card = player.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.isTapped = false;
        // CR 106.4 / 701.43b (issue #3214) — reversing this payment tap undoes
        // the mana ability it paid for, so un-exert the source when THIS tap is
        // what exerted it (Arena of Glory). The activation-side rollback gets
        // this through `untapSourceFromPayment`; this cast-side loop carries its
        // own inline copy of the untap and must restate it, or a cancelled cast
        // leaves the land not untapping for a spell that was never cast.
        restoreExertOnUntap(state, card);
        reverseManaAbilityEffectsOnUntap(card);
        // CR 106.4 / 118.3 / 122.1 — and the counters the tap's own
        // `removeCounter` leg took (a depletion land, a Mana Battery's scaling
        // cost). Same reversal-symmetry class as the exert leg above: this
        // cast-side loop carries its own inline copy of the untap, so every
        // reversal `untapSourceFromPayment` runs has to be restated here or a
        // cancelled cast burns the counter permanently — the land then yields
        // its mana once instead of twice, for a spell that was never cast.
        restoreManaCounterRemovalOnUntap(state, card);
        // CR 605.4 — refund the Wild-Growth-style bonus mana this tap added.
        refundTapBonusMana(player, card);
        // CR 106.6 (issue #1559 review) — restriction-aware refund: reverses
        // the parallel `restrictedMana` deposit (with its rider) instead of
        // always assuming the fungible pool.
        if (card.chosenMana) {
            refundChosenManaOutput(player, card);
        } else {
            const manaColor =
                getBasicLandMana(card) ?? getActivatedManaColor(card);
            if (manaColor) refundFixedManaOutput(player, card, manaColor);
        }
    }
}

/** Roll back the in-progress activated-ability payment and clear
 *  `pendingActivation`. Mirrors `cancelActivation`. */
export function rollbackPendingActivation(state: GameState): void {
    const pa = state.pendingActivation;
    if (!pa) return;
    const player = getPlayer(state, pa.playerId);
    for (const cardId of pa.tappedLandIds) {
        const card = player.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        untapSourceFromPayment(state, player, card);
    }
    state.pendingActivation = undefined;
}

/** A player who surrenders priority (passes / ends the turn) while a mana
 *  payment is still in progress abandons that payment: the spell/ability was
 *  never put on the stack, so the tapped lands must be returned. Without this,
 *  a stale pendingCast/pendingActivation lingers across the priority change —
 *  the PaymentBanner stays up and a later auto-tap could try to commit at an
 *  illegal time (the commit guards then reject it, but the lands would be
 *  stuck tapped). CR 601.2 / 602.2. */
export function abandonPendingPayment(
    state: GameState,
    playerId: string
): void {
    if (state.pendingCast?.playerId === playerId) {
        rollbackPendingCast(state);
    }
    if (state.pendingActivation?.playerId === playerId) {
        rollbackPendingActivation(state);
    }
}
