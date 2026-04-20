import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Player, GrantedAbility } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { formatOracleText } from "~/lib/oracle-text";

export default function PlayerGrantedAbilities({ player }: { player: Player }) {
    const {
        gameId,
        playerId,
        priorityPlayerId,
        pendingCast,
        pendingActivation,
    } = useGameContext();
    const activate = useMutation(api.game.activatePlayerAbility);

    const grants = player.grantedAbilities;
    if (!grants?.length) return null;

    const isMe = player.id === playerId;
    const canActivate =
        isMe &&
        (priorityPlayerId === playerId ||
            pendingCast?.playerId === playerId ||
            pendingActivation?.playerId === playerId);

    const handleClick = (grant: GrantedAbility) => {
        if (!canActivate) return;
        if (grant.cost.life !== undefined && player.life < grant.cost.life) {
            return;
        }
        activate({
            gameId,
            playerId,
            grantedAbilityInstanceId: grant.id,
        });
    };

    return (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 z-20 flex flex-col gap-1">
            {grants.map((grant) => {
                const insufficientLife =
                    grant.cost.life !== undefined &&
                    player.life < grant.cost.life;
                const disabled = !canActivate || insufficientLife;
                return (
                    <button
                        key={grant.id}
                        onClick={() => handleClick(grant)}
                        disabled={disabled}
                        title={grant.oracleText}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-md whitespace-nowrap shadow-md transition-colors ${
                            disabled
                                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                                : "bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer"
                        }`}
                    >
                        {formatOracleText(grant.oracleText)}
                    </button>
                );
            })}
        </div>
    );
}
