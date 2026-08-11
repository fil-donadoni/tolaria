import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { outstandingDamageAssigner } from "~/lib/priority";
import { isPlaneswalker } from "~/lib/card-utils";
import DamageAssignmentPanel from "./damage-assignment-panel";
import BandFormationPanel from "./band-formation-panel";
import AttackDirectionBanner from "./attack-direction-banner";

/** Combat declaration / damage modals for one player's battlefield on the
 *  spatial board ({@link BoardBattlefield}, PRD #249 / slice #281).
 *
 *  These are NOT card-click driven (those branches live in
 *  {@link useBattlefieldInteraction}). They are separate modals gated by the
 *  current combat sub-step:
 *  - {@link BandFormationPanel} — shown to the attacking player while attackers
 *    are still being declared (CR 702.22c), to group banding attackers.
 *  - {@link DamageAssignmentPanel} — shown to whichever player is the
 *    outstanding damage assigner during a combat-damage step (CR 510.1c/d,
 *    702.22j-k), which under banding may be the defender.
 *
 *  Extracted so the gating is computed once and the board mounts the panels at
 *  the correct combat steps. Reads ONLY projected game-context fields (no GRE
 *  import). */
export default function CombatPanels({ player }: { player: Player }) {
    const {
        gameId,
        playerId,
        activePlayerId,
        phase,
        combat,
        allPlayers,
        emblems,
    } = useGameContext();
    const isMe = player.id === playerId;

    if (!combat) return null;

    // Issue #1762 review finding 5 — `combat.confirmed` only flips true in
    // `finalizeConfirmAttackers` (convex/game.ts), which runs AFTER any
    // parked attack tax is paid (`pendingAttackManaTax` — Propaganda /
    // Collective Restraint, CR 508.1c/1g — then `pendingAttackSacrifice` —
    // Flooded Woodlands, CR 701.21a). So confirming attackers with an
    // outstanding tax leaves `combat.confirmed` false while
    // `AttackManaTaxBanner` / `SacrificeBanner` are ALSO on screen — both
    // this dock and those banners pin to the same portrait top strip
    // (`usePromptBannerPosition`) with dragging disabled, so they stacked
    // directly on top of each other with no way to separate them. Attacker
    // SELECTION is already done once a tax is parked (the player already
    // pressed Confirm), so suppress this dock the moment either tax takes
    // over the prompt — it reappears on its own once the tax clears (either
    // paid, finalizing the attack, or canceled, which resets both pendings
    // and `combat.confirmed` stays false).
    const isSelectingAttackers =
        phase === "DECLARE_ATTACKERS" &&
        !combat.confirmed &&
        !combat.pendingAttackManaTax &&
        !combat.pendingAttackSacrifice &&
        isMe &&
        playerId === activePlayerId;

    // CR 508.1a: the planeswalker-retarget hint (and its attack arrows) only
    // matter when the DEFENDING player actually controls a planeswalker.
    const defender = allPlayers.find((p) => p.id !== activePlayerId);
    const defenderHasPlaneswalker =
        defender?.battlefield.some(isPlaneswalker) ?? false;

    // CR 702.22j-k: the player who assigns may be the defender, so gate on the
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
                /* One dock for the whole declare-attackers step (QA info box +
                   banding panel) so the two never overlap. Parked at the TOP of
                   the play area — horizontally centered on the board excluding
                   the reserved right column (`play-area-center-x`, the same
                   centring the nameplates use) and just BELOW the opponent's
                   life indicator. Over the battlefield it covered the very
                   creatures the step asks you to click. */
                <div className="play-area-center-x fixed top-24 z-modal flex w-max max-w-[70vw] -translate-x-1/2 flex-col items-center gap-2">
                    <AttackDirectionBanner
                        planeswalkerPresent={defenderHasPlaneswalker}
                    />
                    <BandFormationPanel
                        combat={combat}
                        attackers={player.battlefield.filter((c) =>
                            combat.attackerIds.includes(c.id)
                        )}
                        gameId={gameId}
                        playerId={playerId}
                    />
                </div>
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
                    emblems={emblems}
                />
            )}
        </>
    );
}
