import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useAttackSequence } from "~/hooks/useAttackSequence";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { isPlaneswalker } from "~/lib/card-utils";
import {
    hasPendingGameIntent,
    trackGameIntent,
} from "~/lib/pending-intent-store";
import type { Player } from "~/types/game";

/** CR 508.1b — the attack target is a real choice only when the defending
 *  player controls a planeswalker; otherwise a click declares at once. */
export function defenderControlsPlaneswalker(
    allPlayers: readonly Player[],
    activePlayerId: string
): boolean {
    return allPlayers.some(
        (p) => p.id !== activePlayerId && p.battlefield.some(isPlaneswalker)
    );
}

/** Where the creatures awaiting a target go: a defending planeswalker, or the
 *  defending player. */
export type AttackTargetChoice =
    | { kind: "planeswalker"; planeswalkerId: string }
    | { kind: "player" };

export type AttackTargetChooser = {
    /** True while a creature still needs its attack target chosen — the
     *  defending player's nameplate and planeswalkers are then candidates. */
    choosing: boolean;
    /** Declare every creature awaiting a target against `choice`. A creature
     *  the server refuses (CR 508.1d pin) stays awaiting, with a visible error. */
    assign: (choice: AttackTargetChoice) => void;
};

/** The one place an attack target is dispatched (CR 508.1b: the target of each
 *  attack is chosen as the attackers are declared). Both target surfaces — a
 *  defending planeswalker (`useBattlefieldInteraction`) and the defending
 *  player's nameplate (`usePlayerInteraction`) — call {@link assign}.
 *
 *  Reuses `toggleAttacker` with no server change: an undeclared creature plus
 *  `planeswalkerId` declares it against the planeswalker; a declared creature
 *  plus `planeswalkerId` retargets it, and repeating the planeswalker it is
 *  already on reverts it to the player. */
export function useAttackTargetChooser(): AttackTargetChooser {
    const { gameId, playerId, combat } = useGameContext();
    const toggleAttacker = useMutation(api.game.toggleAttacker);
    const bufferCtx = usePendingChoiceBuffer();
    const sequence = useAttackSequence();

    // In the "Attack with all" sequence the cursor's attacker is the one
    // choosing; otherwise every clicked (awaiting) creature is.
    const choosers =
        sequence.active && sequence.currentAttackerId
            ? [sequence.currentAttackerId]
            : sequence.awaiting;

    function mutationFor(id: string, choice: AttackTargetChoice) {
        const declared = combat?.attackerIds.includes(id) ?? false;
        const current = combat?.attackTargets?.[id];
        if (choice.kind === "planeswalker") {
            // Already there: toggling again would send it back to the player.
            if (declared && current === choice.planeswalkerId) return null;
            return { planeswalkerId: choice.planeswalkerId };
        }
        if (!declared) return {};
        // Declared against a planeswalker: the repeat toggle reverts to player.
        return current ? { planeswalkerId: current } : null;
    }

    function assign(choice: AttackTargetChoice) {
        // A second click inside the first one's round trip still sees the old
        // combat and cursor: it would re-send the same creature (a repeated
        // planeswalker reads as toggle-off) and double-advance the sequence.
        if (hasPendingGameIntent()) return;
        const ids = [...choosers];
        for (const id of ids) {
            const extra = mutationFor(id, choice);
            const done = () => {
                sequence.resolveAwaiting([id]);
                if (sequence.active) sequence.advance();
            };
            if (extra === null) {
                done();
                continue;
            }
            trackGameIntent(
                toggleAttacker({
                    gameId,
                    playerId,
                    cardInstanceId: id,
                    ...extra,
                })
            ).then(done, (err) => bufferCtx.reportError(err));
        }
    }

    return { choosing: sequence.choosingTarget, assign };
}
