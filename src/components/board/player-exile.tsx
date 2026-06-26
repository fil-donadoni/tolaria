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

    // Cards pinned to the permanent that exiled them (projected
    // `exiledByPermanentId`, set only while that permanent is on a battlefield)
    // render attached to it on the board (Arena treatment,
    // `board-battlefield-card.tsx`). De-duplicate them from the loose Exile pile
    // so each appears in exactly one place. Cards whose exiler has left (or
    // unlinked exile) keep their normal pile slot.
    const pileCards = player.exile.filter((c) => !c.exiledByPermanentId);

    return (
        <div
            data-arrow-anchor-exile={player.id}
            className="w-(--card-w-sm) aspect-5/7"
        >
            <div className="relative">
                <CardsPile
                    cards={pileCards}
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
