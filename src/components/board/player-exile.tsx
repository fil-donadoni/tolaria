import type { Player } from "~/types/game";
import CardsPile from "./cards-pile";

export default function PlayerExile({ player }: { player: Player }) {
    return (
        <div
            data-arrow-anchor-exile={player.id}
            className="w-[var(--card-w-sm)] aspect-5/7"
        >
            <div className="relative">
                <CardsPile
                    cards={player.exile}
                    emptyLabel="Exile"
                    title="Exile"
                />
            </div>
        </div>
    );
}
