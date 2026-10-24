import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { orderLibrarySearchCards } from "~/lib/library-search-order";
import CardsPile from "./cards-pile";
import LibrarySearchConfirm from "./library-search-confirm";

/** Modal picker for a `choose-outside-game-card` pick (CR 400.11b — the Wish
 *  cycle: "You may reveal a sorcery card you own from outside the game and
 *  put it into your hand"). The cards are in no zone (CR 400.11), so nothing
 *  on the board is clickable: `projectPublicState` hands the CHOOSER exactly
 *  the matching cards on `outsideGamePeek` while the pick is head-of-queue,
 *  and this dialog renders them. Reuses the `search-library` picker surface
 *  (a `CardsPile` grid + `LibrarySearchConfirm`, driven by the shared
 *  `usePendingChoiceBuffer`); the pick is optional, so the confirm reads
 *  "Skip" until a card is chosen. */
export default function OutsideGameCardPick() {
    const { playerId, allPlayers, pendingChoices } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    const { isMinimized, minimize } = useMinimizedChoice();

    const head = pendingChoices?.[0];
    const active =
        !!head &&
        head.kind === "choose-outside-game-card" &&
        head.playerId === playerId;
    if (!active) return null;

    const ownerId = head.zoneOwnerId ?? head.playerId;
    const cards = orderLibrarySearchCards(
        allPlayers.find((p) => p.id === ownerId)?.outsideGamePeek ?? []
    );

    const count = head.count;
    const min = typeof count === "number" ? count : count.min;
    const max = typeof count === "number" ? count : count.max;

    // One pick at most: a fresh click replaces the held one, a click on the
    // held one clears it.
    const onCardClick = (card: { id: string }) => {
        if (bufferCtx.buffer.includes(card.id)) {
            bufferCtx.toggle(card.id);
            return;
        }
        if (bufferCtx.buffer.length >= max) {
            if (max !== 1) return;
            bufferCtx.clear();
        }
        bufferCtx.toggle(card.id);
    };

    return (
        <CardsPile
            cards={cards}
            isFaceDown={false}
            layout="grid"
            title={head.prompt ?? "Choose a card from outside the game"}
            forceOpen={!isMinimized}
            onMinimize={minimize}
            selectedIds={bufferCtx.buffer}
            onCardClick={onCardClick}
            footer={<LibrarySearchConfirm min={min} max={max} />}
        />
    );
}
