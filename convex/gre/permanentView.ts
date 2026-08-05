// The single authority on "a permanent as a `matchesPermanentFilter` sees it"
// (CR 105.2 / 400.7 / 613).
//
// `matchesPermanentFilter` takes a `MatchablePermanent`. A raw
// `CardInstanceState` is STRUCTURALLY assignable to one — which is exactly the
// trap. Three of the fields a filter reads are DERIVED, never stored on the
// instance:
//
//   * `colors`            — layer 5 (`colorOverride`, `grantedColors`)
//   * `power` / `toughness` — layer 7a-e (counters, anthems, temporary buffs)
//   * `enteredThisTurn` / `controlledSinceTurnStart` — computed off `state`
//
// so a raw instance handed to the filter reads `undefined` for all of them and
// the clause fails CLOSED. That is silent: the caller sees an EMPTY candidate
// list, not an error. It has bitten the same way at least four times —
// Magnetic Mountain's "blue creatures" untap veto, the pending-choice submit
// validator rejecting a pick the choice itself offered, and (issue #1209) the
// bot enumerator's `tapOtherFilter` / `sacrificeFilter` payability pre-checks,
// where a colour-filtered activation cost (Hand of Justice's "three untapped
// WHITE creatures", Thelonite Monk's "a green creature") matched nothing and
// the whole activation was dropped as illegal.
//
// This module exists so there is ONE function to reach for and the next call
// site cannot get it wrong. It deliberately lives BELOW `phases.ts` (which
// re-exports it for its historical importers) so the cost/payment path —
// `moves.ts`, `game.ts`, `sacrificeChoice.ts`, `paymentPicks.ts` — can import
// it without pulling in the phase machinery.

import type { CardInstanceState, GameState } from "./state";
import { hasControlledSinceTurnStart } from "./controlContinuity";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";

/** Returns a `MatchablePermanent`-shaped view of `card` with its `power` and
 *  `toughness` overridden by the effective values read at call time
 *  (CR 613 layer 7c/7d — counters, +N/+N auras, temporary buffs), its effective
 *  `colors` populated (CR 105 / 202.2 / 613.1d — layer-5 `colorOverride` +
 *  `grantedColors`), and the two DERIVED turn-scoped flags computed off state
 *  (CR 400.7). Pass this — never the raw instance — to
 *  `matchesPermanentFilter`. */
export function effectivePermanentView(
    state: GameState,
    card: CardInstanceState
): CardInstanceState {
    // CR 105 / 202.2 / 613.1d — populate effective colors so color-scoped
    // filters (Magnetic Mountain's "blue creatures") match on the battlefield.
    // `colors` honors layer-5 colorOverride + grantedColors via getColors.
    const colors = STATIC_EFFECT_CTX.getColors(card);
    // CR 400.7 — the two DERIVED turn-scoped `MatchablePermanent` flags. Both
    // are computed off state, not stored on the instance, so a raw
    // `CardInstanceState` handed to `matchesPermanentFilter` leaves them
    // undefined and the filter fails CLOSED — i.e. the pending-choice submit
    // validator would reject a pick the choice itself offered. Derived here,
    // once, for every caller of this view.
    const turnFlags = {
        enteredThisTurn: card.enteredOnTurn === state.turn,
        controlledSinceTurnStart: hasControlledSinceTurnStart(state, card),
    };
    if (!card.types.includes("Creature")) {
        return { ...card, colors, ...turnFlags } as CardInstanceState;
    }
    return {
        ...card,
        colors,
        ...turnFlags,
        power: getEffectivePower(state, card),
        toughness: getEffectiveToughness(state, card),
    } as CardInstanceState;
}
