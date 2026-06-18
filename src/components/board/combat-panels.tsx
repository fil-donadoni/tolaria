import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { outstandingDamageAssigner } from "~/lib/priority";
import DamageAssignmentPanel from "./damage-assignment-panel";
import BandFormationPanel from "./band-formation-panel";

/** Combat declaration / damage modals for one player's battlefield on the
 *  spatial board ({@link BoardNextBattlefield}, PRD #249 / slice #281).
 *
 *  These are NOT card-click driven (those branches live in
 *  {@link useBattlefieldInteraction}). They are separate modals gated by the
 *  current combat sub-step:
 *  - {@link BandFormationPanel} — shown to the attacking player while attackers
 *    are still being declared (CR 702.21e), to group banding attackers.
 *  - {@link DamageAssignmentPanel} — shown to whichever player is the
 *    outstanding damage assigner during a combat-damage step (CR 510.1c/d,
 *    702.21j-k), which under banding may be the defender.
 *
 *  Extracted so the gating is computed once and the board mounts the panels at
 *  the correct combat steps. Reads ONLY projected game-context fields (no GRE
 *  import). */
export default function CombatPanels({ player }: { player: Player }) {
    const { gameId, playerId, activePlayerId, phase, combat, allPlayers } =
        useGameContext();
    const isMe = player.id === playerId;

    if (!combat) return null;

    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !combat.confirmed &&
        isMe &&
        playerId === activePlayerId;

    // CR 702.21j-k: the player who assigns may be the defender, so gate on the
    // outstanding assigner rather than always the active player.
    const isAssigningDamage =
        (phase === "COMBAT_DAMAGE" || phase === "FIRST_STRIKE_DAMAGE") &&
        combat.damageConfirmed === false &&
        isMe &&
        playerId ===
            outstandingDamageAssigner({
                playerId,
                activePlayerId,
                priorityPlayerId: activePlayerId,
                phase,
                combat,
            });

    return (
        <>
            {isSelectingAttackers && (
                <BandFormationPanel
                    combat={combat}
                    attackers={player.battlefield.filter((c) =>
                        combat.attackerIds.includes(c.id)
                    )}
                    gameId={gameId}
                    playerId={playerId}
                />
            )}

            {isAssigningDamage && (
                <DamageAssignmentPanel
                    combat={combat}
                    allPlayers={allPlayers}
                    gameId={gameId}
                    playerId={playerId}
                    defenderId={
                        allPlayers.find((p) => p.id !== activePlayerId)?.id ??
                        ""
                    }
                />
            )}
        </>
    );
}
