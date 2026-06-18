import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/** Player-facing interaction controller for one player nameplate/face (PRD
 *  #249, slice #280). Mirrors how {@link useBattlefieldInteraction} (#272) was
 *  extracted from `PlayerBattlefield`: the classic life chrome
 *  (`player-life.tsx`) and the spatial player (`board-next-player.tsx`) both
 *  consume this hook, so clicking a player as a target / damage-choice
 *  dispatches the SAME GRE-boundary mutation / toggles the SAME buffer on
 *  either board.
 *
 *  This hook OWNS, for one player:
 *  - the `selectTarget` mutation (player-as-target, `targetType: "player"`),
 *  - the pending-choice-buffer toggle for a mid-resolution
 *    "any target of an opponent's choice" damage-target pick
 *    (Cuombajj Witches, CR 115.4 / 608.2),
 *  - the derived flags the view layer needs to render the targeting / choice
 *    ring and the priority glow.
 *
 *  Reads ONLY projected (`PublicGameState` / `FullGameState`) fields exposed by
 *  `useGameContext()` — no GRE engine import, consistent with the wire-format
 *  rule in CLAUDE.md. */
export type PlayerInteraction = {
    /** This nameplate represents the local viewer's own seat. */
    isMe: boolean;
    /** This player currently holds priority. */
    hasPriority: boolean;
    /** A spell/ability targeting a player can legally target this one and the
     *  viewer is the one choosing. */
    isTargetable: boolean;
    /** A choose-damage-target choice owed to the viewer lists this player as an
     *  eligible candidate. */
    isDamageTargetPickable: boolean;
    /** Whether this player is currently buffered in the damage-target pick. */
    isPlayerPicked: boolean;
    /** Click handler: routes to `selectTarget` (target) or the choice-buffer
     *  toggle (damage-target), or no-ops when neither applies. */
    handleClick: () => void;
};

export function usePlayerInteraction(player: Player): PlayerInteraction {
    const {
        gameId,
        playerId,
        priorityPlayerId,
        pendingTarget,
        pendingChoices,
    } = useGameContext();
    const isMe = player.id === playerId;
    const hasPriority = player.id === priorityPlayerId;

    const selectTargetMut = useMutation(api.game.selectTarget);
    const bufferCtx = usePendingChoiceBuffer();

    const isTargetable =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        (pendingTarget.targetType === "player" ||
            pendingTarget.targetType === "any");

    // Mid-resolution "any target of an opponent's choice" (CR 115.4 / 608.2,
    // Cuombajj Witches). The chooser (viewer == choice.playerId) may pick a
    // player as the damage target — routed through the same client buffer as
    // the battlefield permanent picks (toggle then Done).
    const damageTargetChoice = pendingChoices?.[0];
    const isDamageTargetPickable =
        !!damageTargetChoice &&
        damageTargetChoice.kind === "choose-damage-target" &&
        damageTargetChoice.playerId === playerId &&
        (damageTargetChoice.candidatePlayerIds?.includes(player.id) ?? false);
    const isPlayerPicked =
        isDamageTargetPickable && bufferCtx.buffer.includes(player.id);

    function handleClick() {
        if (isTargetable) {
            selectTargetMut({
                gameId,
                playerId,
                targetType: "player",
                targetId: player.id,
            });
            return;
        }
        if (isDamageTargetPickable) {
            bufferCtx.toggle(player.id);
        }
    }

    return {
        isMe,
        hasPriority,
        isTargetable,
        isDamageTargetPickable,
        isPlayerPicked,
        handleClick,
    };
}
