import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

type PlayerLifeProps = {
    player: Player;
};

export default function PlayerLife({ player }: PlayerLifeProps) {
    const {
        gameId,
        playerId,
        priorityPlayerId,
        pendingTarget,
        pendingChoices,
    } = useGameContext();
    const isMe = player.id === playerId;
    const hasPriority = player.id === priorityPlayerId;
    // Colour the nameplate ring by seat (#152): emerald when it's the local
    // player, amber for the opponent — matching the board-edge PriorityIndicator.
    const priorityRing = hasPriority
        ? isMe
            ? "ring-2 ring-emerald-400"
            : "ring-2 ring-amber-400"
        : "";
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

    const ringClass = isTargetable
        ? "ring-2 ring-orange-400 cursor-pointer hover:ring-orange-300"
        : isDamageTargetPickable
          ? isPlayerPicked
              ? "ring-2 ring-orange-500 cursor-pointer"
              : "ring-2 ring-orange-400 cursor-pointer hover:ring-orange-300"
          : "";

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

    return (
        <div
            data-arrow-anchor-player={player.id}
            className={`bg-slate-900 text-white text-center px-3 py-2 rounded-md shrink-0 ${priorityRing} ${ringClass}`}
            onClick={handleClick}
        >
            <h2 className="text-3xl font-bold leading-tight">{player.life}</h2>
            <p className="text-xs">{player.name}</p>
        </div>
    );
}
