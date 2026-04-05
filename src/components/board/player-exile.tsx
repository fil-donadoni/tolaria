import type { Player } from "~/types/game";
import CardsPile from "./cards-pile";

export default function PlayerExile({ player }: { player: Player }) {
    return (
        <div className="w-24 aspect-5/7">
            <div className="relative">
                <CardsPile cards={player.exile} emptyLabel="Exile" />
            </div>
        </div>
    );
}
