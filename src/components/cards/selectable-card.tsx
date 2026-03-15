import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";

import type { CardAction, CardInstance } from "~/types/game";

import CardImage from "./card-image";

type SelectableCardProps = {
    cardInstance: CardInstance;
    allowedActions?: CardAction[];
};

export default function SelectableCard({
    cardInstance,
    allowedActions = [],
}: SelectableCardProps) {
    // const { playCard, castCard, putCardToGraveyard, putCardToExile } =
    //     useGameStore();

    const onPlayClick = () => {
        console.log(`Playing card ${cardInstance.id}`);

        // playCard(cardInstance);
    };

    const onCastClick = () => {
        console.log(`Casting card ${cardInstance.id}`);

        // castCard(cardInstance);
    };

    const onDiscardClick = () => {
        console.log(`Discarding card ${cardInstance.id}`);

        // putCardToGraveyard(cardInstance);
    };

    const onExileClick = () => {
        console.log(`Exiling card ${cardInstance.id}`);

        // putCardToExile(cardInstance);
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger className="flex items-center justify-center rounded-md border border-dashed text-sm">
                <CardImage card={cardInstance.card} />
            </ContextMenuTrigger>

            <ContextMenuContent className="w-48">
                {allowedActions?.includes("play") && (
                    <ContextMenuItem inset onClick={onPlayClick}>
                        Play
                    </ContextMenuItem>
                )}

                {allowedActions?.includes("cast") && (
                    <ContextMenuItem inset onClick={onCastClick}>
                        Cast
                    </ContextMenuItem>
                )}

                {allowedActions?.includes("putToGraveyard") && (
                    <ContextMenuItem inset onClick={onDiscardClick}>
                        Put to graveyard
                    </ContextMenuItem>
                )}

                {allowedActions?.includes("discard") && (
                    <ContextMenuItem inset onClick={onDiscardClick}>
                        Discard
                    </ContextMenuItem>
                )}

                {allowedActions?.includes("putToExile") && (
                    <ContextMenuItem inset onClick={onExileClick}>
                        Exile
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
