import type { Player } from "~/types/game";
import PlayerBattlefield from "./player-battlefield";
import PlayerSideRow from "./player-side-row";
import { useGameContext } from "~/hooks/useGameContext";

export default function PlayerBoard({ player }: { player: Player }) {
    const { playerId, priorityPlayerId } = useGameContext();
    const isMe = player.id === playerId;
    // Ambient priority cue (issue #152): a soft glow washes the half of the
    // board belonging to whoever currently holds priority, complementing the
    // nameplate ring in PlayerLife and the board-edge PriorityIndicator. The
    // colour distinguishes the seats — emerald for the local player, amber for
    // the opponent — so a glance tells you whose half is lit.
    const hasPriority = player.id === priorityPlayerId;
    const glow = isMe
        ? "rgba(16,185,129," // emerald
        : "rgba(251,191,36,"; // amber

    return (
        <div
            className="flex-1 flex flex-col relative min-h-0"
            style={{
                backgroundColor: player.bgColor,
                backgroundImage: hasPriority
                    ? `radial-gradient(circle at 50% 50%, ${glow}0.10), ${glow}0) 72%)`
                    : undefined,
                boxShadow: hasPriority
                    ? `inset 0 0 60px ${glow}0.16)`
                    : undefined,
            }}
        >
            <div
                className={`flex-1 flex flex-col min-h-0 ${isMe ? "" : "flex-col-reverse"}`}
            >
                <PlayerBattlefield player={player} />
                <PlayerSideRow player={player} />
            </div>
        </div>
    );
}
