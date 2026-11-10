// The sacrifice pick (CR 701.21a), auth-free — moved out of `convex/game.ts`
// (issue #9002) so the Bot liveness ladder can answer a parked attack-sacrifice
// tax with the SAME core the `selectSacrifice` mutation runs.
import {
    assertGameNotOver,
    isInlineManaAbilityPark,
    tryAutoCommitPendingActivation,
    tryAutoCommitPendingCast,
} from "./activation";
import { finalizeConfirmAttackers } from "./attackDeclaration";
import { applyEmergeReduction } from "./emerge";
import { assertExpectedInput } from "./expectedInput";
import {
    applySacrificeSelection,
    isSacrificeCandidateLegal,
    isSacrificeSelectionComplete,
    type SacrificeSelection,
} from "./sacrificeChoice";
import type { GameState } from "./state";

/** The single sacrifice selection currently awaiting `playerId`'s choice, and
 *  which in-flight container holds it (CR 701.21a). At most one is active. */
export function findActiveSacrificeSelection(
    state: GameState,
    playerId: string
): {
    sel: SacrificeSelection;
    container: "cast" | "activation" | "attack";
} | null {
    // CR 605.3a / 605.3b (issue #3455) — a MANA ability announced while a
    // spell's cost is being paid is the INNERMOST announcement, so its victim
    // pick is the one this player is being asked for. Checked before the cast,
    // mirroring `nextOwedPayment`'s own hoist: the two must name the same
    // selection or the pick lands in the wrong container.
    const inline = state.pendingActivation;
    if (
        inline?.resolveWithoutStack &&
        inline.playerId === playerId &&
        inline.sacrificeSelection &&
        !isSacrificeSelectionComplete(inline.sacrificeSelection)
    ) {
        return { sel: inline.sacrificeSelection, container: "activation" };
    }
    const pc = state.pendingCast;
    if (
        pc &&
        pc.playerId === playerId &&
        pc.sacrificeSelection &&
        !isSacrificeSelectionComplete(pc.sacrificeSelection)
    ) {
        return { sel: pc.sacrificeSelection, container: "cast" };
    }
    const pa = state.pendingActivation;
    if (
        pa &&
        pa.playerId === playerId &&
        pa.sacrificeSelection &&
        !isSacrificeSelectionComplete(pa.sacrificeSelection)
    ) {
        return { sel: pa.sacrificeSelection, container: "activation" };
    }
    const at = state.combat?.pendingAttackSacrifice;
    if (at && at.playerId === playerId && !isSacrificeSelectionComplete(at)) {
        return { sel: at, container: "attack" };
    }
    return null;
}

/** CR 701.21a — the sacrificing player picks one permanent to sacrifice. Routes
 *  to whichever in-flight action is awaiting this player's sacrifice choice
 *  (cast, activation, or attack-declaration tax — exactly one is active). When
 *  the choice completes, resumes the parked action. */
export function selectSacrificeOnState(
    state: GameState,
    args: { playerId: string; cardInstanceId: string }
): void {
    assertGameNotOver(state);

    // The container decides the Expected Input this pick belongs to
    // (ADR 0047). A cast/activation sacrifice is paid inside a priority
    // window (the payer holds priority), so it expects `priority`. The
    // attack-declaration land tax (CR 508.1c/1g) is a parked turn-based
    // action, not a priority window, so it expects `sacrifice` — the gate
    // then rejects any competing priority action (endTurn / passPriority /
    // casting) until the pick clears. Determining the container is
    // read-only, so it may precede the gate.
    const active = findActiveSacrificeSelection(state, args.playerId);
    if (!active) throw new Error("No sacrifice choice awaiting you");
    const { sel, container } = active;
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: container === "attack" ? "sacrifice" : "priority",
        // CR 608.2g / 605.3a (issue #3455) — a MANA ability is activatable
        // inside a may-pay window, where the Expected Input is the `choice`
        // itself. Answering the pick that activation parked on is part of the
        // same window: without this the park could be opened there and never
        // closed, which is a freeze rather than a rejection.
        allowManaForMayPay: isInlineManaAbilityPark(state, args.playerId),
    });
    if (!isSacrificeCandidateLegal(state, sel, args.cardInstanceId)) {
        throw new Error("Selected permanent is not a legal sacrifice");
    }
    sel.picked.push(args.cardInstanceId);

    if (isSacrificeSelectionComplete(sel)) {
        if (container === "cast") {
            // CR 702.119a / 702.119c — the emerge victim is now chosen, so
            // the total it reduces is final before any pool test commits it.
            const pc = state.pendingCast!;
            if (pc.emergeReductionOwed) {
                applyEmergeReduction(state, pc.manaCost, sel);
                delete pc.emergeReductionOwed;
            }
            // tryAutoCommitPendingCast applies the selection + finalizes when
            // mana is also covered (else the player keeps tapping lands).
            tryAutoCommitPendingCast(state, args.playerId);
        } else if (container === "activation") {
            tryAutoCommitPendingActivation(state, args.playerId);
        } else {
            // Attack tax: apply and finalize the declaration (the cast /
            // activation resume paths apply internally; this one does not).
            applySacrificeSelection(state, sel);
            if (state.combat) {
                state.combat.pendingAttackSacrifice = undefined;
            }
            finalizeConfirmAttackers(state);
        }
    }
}
