import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import CardsPile from "./cards-pile";

function libraryPlaceholders(count: number, playerId: string): CardInstance[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `lib-${playerId}-${i}`,
        card: { id: "" },
        controllerId: playerId,
        ownerId: playerId,
        zone: "library",
        isTapped: false,
    }));
}

export default function PlayerLibrary({ player }: { player: Player }) {
    const { gameId, playerId, debugAllActions, pendingChoices } =
        useGameContext();
    const draw = useMutation(api.game.drawCard);
    const millCard = useMutation(api.game.mill);
    const exile = useMutation(api.game.exileFromLibrary);
    const bufferCtx = usePendingChoiceBuffer();
    const isMe = player.id === playerId;

    // CR 401.4 / 701.19: while a `search-library` choice is active for the
    // viewer and this library belongs to the chooser, the projection exposes
    // the searcher's library as `librarySearch` — render those cards face-up
    // and route clicks to the choice mutation.
    const head = pendingChoices?.[0];
    const isLibrarySearchTarget =
        !!head &&
        head.kind === "search-library" &&
        head.zone === "library" &&
        head.playerId === playerId &&
        player.id === playerId &&
        !!player.librarySearch;

    const libraryCards = isLibrarySearchTarget
        ? player.librarySearch!
        : Array.isArray(player.library)
          ? player.library
          : libraryPlaceholders(player.library.count, player.id);
    const hasCards = libraryCards.length > 0;

    const handleDraw = () => draw({ gameId, playerId });
    const handleMill = () => millCard({ gameId, playerId });
    const handleExile = () => exile({ gameId, playerId });
    const onCardClick = isLibrarySearchTarget
        ? (card: { id: string }) => bufferCtx.toggle(card.id)
        : undefined;

    const pile = (
        <CardsPile
            cards={libraryCards}
            isFaceDown={!isLibrarySearchTarget}
            emptyLabel="Library is empty"
            title={isLibrarySearchTarget ? "Search your library" : "Library"}
            onCardClick={onCardClick}
            forceOpen={isLibrarySearchTarget}
        />
    );

    if (!isMe || !hasCards || !debugAllActions) {
        return (
            <div className="w-[var(--card-w-sm)] aspect-5/7">
                <div className="relative">{pile}</div>
            </div>
        );
    }

    return (
        <div className="w-[var(--card-w-sm)] aspect-5/7">
            <ContextMenu>
                <ContextMenuTrigger>
                    <div className="relative cursor-pointer">{pile}</div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                    <ContextMenuItem inset onClick={handleDraw}>
                        Draw
                    </ContextMenuItem>
                    <ContextMenuItem inset onClick={handleMill}>
                        Mill
                    </ContextMenuItem>
                    <ContextMenuItem inset onClick={handleExile}>
                        Exile
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        </div>
    );
}
