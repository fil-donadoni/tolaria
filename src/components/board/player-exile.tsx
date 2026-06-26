import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import CardsPile from "./cards-pile";
import ExileIcon from "../icons/exile-icon";
import ExileCastButton from "./exile-cast-button";

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
    const { playerId } = useGameContext();

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
                    // CR 601.3e — a card a player has exiled with cast-from-exile
                    // permission (Ice Cauldron) is castable by that player from
                    // the Exile zone. Surface a Cast button on those cards; the
                    // backend cast mutation already validates the exile origin.
                    renderCardAction={(card, onClose) =>
                        card.castableFromExileBy === playerId ? (
                            <ExileCastButton
                                card={card}
                                onCommitted={onClose}
                            />
                        ) : null
                    }
                />
            </div>
        </div>
    );
}
