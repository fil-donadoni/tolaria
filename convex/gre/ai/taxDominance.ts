// Dominated tax declines (issue #9832) — a `may-pay` node's decline, when
// declining costs the payer its own spell and paying costs it only mana.
//
// "Counter target spell unless its controller pays {N}" (CR 118.12a, the
// `mayPay` Op + an `if (not paid)` arm that counters, CR 701.6a) asks the
// TARGET's controller as the counter resolves. ISMCTS explores both answers at
// that node, and its mean backup credits the line that led there with every
// visit spent on the decline: measured on Daze into an opponent holding one
// untapped Plains, the cast's mean sat at 0.31 against `pass` at 0.27, because
// roughly a third of the payer's visits went to letting its own Serra Angel be
// countered. The Bot then threw a card and a land into a tax the opponent
// could pay.
//
// The decline is DOMINATED when both hold:
//   - an accept is offered whose cost is mana alone. `mayPayAnswers` emits an
//     accept only when `mayPayTapPlan` finds the pool plus the payer's
//     untapped sources cover it (CR 608.2g), so "can pay" is that generator's
//     own answer and never a second computation here. A life, sacrifice,
//     discard, energy or graveyard leg gives something up beside mana, and
//     its trade against the spell is the search's to weigh, never pruned.
//   - declining loses a spell the payer controls on the stack, and that
//     accept keeps it: simulated through the real engine on a clone of each
//     answer (`apply` is the search's own `applyMoveInSearch`), never read
//     off the script. A spell counts as lost when it has left the stack for
//     anywhere but a battlefield — countered into the graveyard, exiled,
//     returned to hand — and as kept while it is on the stack or has
//     resolved onto the battlefield.
//
// Shape-blind on purpose: any Op that removes the payer's spell when the tax
// goes unpaid (`counter`, `moveSpellFromStack`), fixed or X tax, is the same
// class, and no card is named (ADR 0102). The payer that could pay by tapping
// a land it wants later still "can pay": opponent sequencing is not modelled.
//
// Tree only, below the root (`withoutDominatedTaxDeclines`, `search.ts`),
// like `targetDominance.ts`: the defect is the node's mean backup, the root
// weighs every move, and the decline stays LEGAL — the engine accepts it and
// a human is still offered it. Fails CLOSED to "keep": a throw, a non-mana
// leg or an outcome that loses nothing keeps the decline.

import type { GameState, PendingChoice } from "../state";
import { normalizeMayPayCost } from "../state";
import type { Move } from "../moves";
import { cloneGameState } from "../clone";

/** Ids of the spells `playerId` controls on `state`'s stack. */
function controlledStackSpellIds(state: GameState, playerId: string): string[] {
    return state.stack
        .filter(
            (item) =>
                item.controllerId === playerId &&
                !item.triggeredAbilityId &&
                !item.abilityId
        )
        .map((item) => item.id);
}

/** Whether any of `ids` has left the stack for a zone other than a
 *  battlefield on `state` — the spell is gone, not resolved. */
function losesAny(state: GameState, ids: readonly string[]): boolean {
    const onStack = new Set(state.stack.map((item) => item.id));
    const onBattlefield = new Set(
        state.players.flatMap((p) => p.battlefield.map((c) => c.id))
    );
    return ids.some((id) => !onStack.has(id) && !onBattlefield.has(id));
}

/** Whether `move` is an accept whose payment is mana alone. */
function isManaOnlyAccept(move: Move, choice: PendingChoice): boolean {
    if (move.kind !== "may-pay" || !move.accept || !choice.cost) return false;
    if (move.sacrificeIds || move.discardIds || move.graveyardIds) {
        return false;
    }
    const legs = normalizeMayPayCost(choice.cost);
    return (
        legs.mana !== undefined &&
        Object.keys(legs).every((leg) => leg === "mana")
    );
}

/** The outcome of answering `move` on a clone of `state`, or `undefined`
 *  when the engine refused it. */
function answered(
    state: GameState,
    move: Move,
    apply: (probe: GameState, move: Move) => void
): GameState | undefined {
    const probe = cloneGameState(state);
    try {
        apply(probe, move);
    } catch {
        return undefined;
    }
    return probe;
}

/** Whether the decline among `moves` — the answers to `state`'s head
 *  `may-pay` choice — is dominated by a mana-only accept (see the header).
 *  `false` off a `may-pay` head, with no decline or no mana-only accept on
 *  offer, or when the payer has no spell of its own on the stack. */
export function isDominatedTaxDecline(
    state: GameState,
    moves: readonly Move[],
    apply: (probe: GameState, move: Move) => void
): boolean {
    const choice = state.pendingChoices?.[0];
    if (choice?.kind !== "may-pay") return false;
    const decline = moves.find((m) => m.kind === "may-pay" && !m.accept);
    const accept = moves.find((m) => isManaOnlyAccept(m, choice));
    if (!decline || !accept) return false;
    const spells = controlledStackSpellIds(state, choice.playerId);
    if (spells.length === 0) return false;
    const declined = answered(state, decline, apply);
    if (!declined || !losesAny(declined, spells)) return false;
    const accepted = answered(state, accept, apply);
    return accepted !== undefined && !losesAny(accepted, spells);
}
