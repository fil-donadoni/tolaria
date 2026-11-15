import { usePlainPriorityWindow } from "~/hooks/usePlainPriorityWindow";
import {
    cardHasLegalAction,
    libraryTopActionSources,
} from "~/lib/card-actionable";
import type { Player } from "~/types/game";
import CardsPile from "./cards-pile";
import LibraryCastButton from "./library-cast-button";
import LibraryPlayLandButton from "./library-play-land-button";

/** Outside-the-game plays (CR 400.11b — "You may play a card you own from
 *  outside the game this turn"). Rendered in the viewer's own pile rail while
 *  the projection carries `outsideGamePlayable`: their outside-the-game pool,
 *  present only while they hold the permission and never on the opponent's
 *  view (the holder is hidden information, projected to its owner alone), so
 *  this renders nothing for anyone else.
 *
 *  Each card's affordance is the same pair the library top uses — a land is
 *  played, anything else is cast (CR 305.9) — because both buttons read only
 *  the card's projected `legalActions` and commit through
 *  `useHandCardCommit`: the server locates the card in the pool
 *  (`locateCastSource` / `resolvePlayLandSourceZone`) and re-validates. */
export default function PlayerOutsideGamePlays({
    player,
    open,
    onOpenChange,
}: {
    player: Player;
    /** Controlled-open, as for the sibling piles (#336). */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const priorityWindowOpen = usePlainPriorityWindow();
    const cards = player.outsideGamePlayable ?? [];
    if (cards.length === 0) return null;

    const actionableIds = new Set(
        cards
            .filter((card) =>
                cardHasLegalAction(
                    priorityWindowOpen,
                    libraryTopActionSources(card)
                )
            )
            .map((card) => card.id)
    );

    return (
        <CardsPile
            cards={cards}
            isFaceDown={false}
            layout="grid"
            title="Outside the game"
            emptyLabel="Outside the game"
            actionableIds={actionableIds}
            open={open}
            onOpenChange={onOpenChange}
            renderCardAction={(card, onClose) =>
                (card.types ?? []).includes("Land") ? (
                    <LibraryPlayLandButton card={card} onCommitted={onClose} />
                ) : (
                    <LibraryCastButton card={card} onCommitted={onClose} />
                )
            }
        />
    );
}
