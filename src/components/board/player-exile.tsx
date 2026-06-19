import type { Player } from "~/types/game";
import CardsPile from "./cards-pile";
import ExileIcon from "../icons/exile-icon";

export default function PlayerExile({
    player,
    open,
    onOpenChange,
}: {
    player: Player;
    /** Controlled-open (portrait chip, #336). */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    return (
        <div
            data-arrow-anchor-exile={player.id}
            className="w-(--card-w-sm) aspect-5/7"
        >
            <div className="relative">
                <CardsPile
                    cards={player.exile}
                    emptyLabel="Exile"
                    title="Exile"
                    zoneIcon={<ExileIcon className="w-8 h-8 opacity-60" />}
                    open={open}
                    onOpenChange={onOpenChange}
                />
            </div>
        </div>
    );
}
