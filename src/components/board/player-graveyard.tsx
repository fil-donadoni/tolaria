import type { Player } from "~/types/game";
import CardsPile from "./cards-pile";

export default function PlayerGraveyard({ player }: { player: Player }) {
    return (
        <div className="w-[var(--card-w-sm)] aspect-5/7">
            <div className="relative">
                <CardsPile
                    cards={player.graveyard}
                    emptyLabel="Graveyard"
                    title="Graveyard"
                />
            </div>
        </div>
    );
}
