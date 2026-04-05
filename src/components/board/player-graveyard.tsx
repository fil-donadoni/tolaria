import type { Player } from "~/types/game";
import CardsPile from "./cards-pile";

export default function PlayerGraveyard({ player }: { player: Player }) {
    return (
        <div className="w-24 aspect-5/7">
            <div className="relative">
                <CardsPile
                    cards={player.graveyard}
                    emptyLabel="Graveyard"
                />
            </div>
        </div>
    );
}
