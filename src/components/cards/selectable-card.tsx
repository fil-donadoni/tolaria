import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";

import type { CardAction, CardInstance } from "~/types/game";

import CardImage from "./card-image";

type SelectableCardProps = {
    cardInstance: CardInstance;
    playerId: string;
    allowedActions?: CardAction[];
};

export default function SelectableCard({
    cardInstance,
    playerId,
    allowedActions = [],
}: SelectableCardProps) {
    const { gameId } = useGameContext();
    const playCard = useMutation(api.game.playCard);

    const onPlayClick = () => {
        playCard({
            gameId,
            playerId,
            cardInstanceId: cardInstance.id,
        });
    };

    const onCastClick = () => {
        console.log(`Casting card ${cardInstance.id}`);
    };

    const onDiscardClick = () => {
        console.log(`Discarding card ${cardInstance.id}`);
    };

    const onExileClick = () => {
        console.log(`Exiling card ${cardInstance.id}`);
    };

    const hasActions = allowedActions.length > 0;

    if (!hasActions) {
        return <CardImage card={cardInstance.card} />;
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger className="flex items-center justify-center rounded-md border border-dashed text-sm">
                <CardImage card={cardInstance.card} />
            </ContextMenuTrigger>

            <ContextMenuContent className="w-48">
                {allowedActions.includes("play") && (
                    <ContextMenuItem inset onClick={onPlayClick}>
                        Play
                    </ContextMenuItem>
                )}

                {allowedActions.includes("cast") && (
                    <ContextMenuItem inset onClick={onCastClick}>
                        Cast
                    </ContextMenuItem>
                )}

                {allowedActions.includes("putToGraveyard") && (
                    <ContextMenuItem inset onClick={onDiscardClick}>
                        Put to graveyard
                    </ContextMenuItem>
                )}

                {allowedActions.includes("discard") && (
                    <ContextMenuItem inset onClick={onDiscardClick}>
                        Discard
                    </ContextMenuItem>
                )}

                {allowedActions.includes("putToExile") && (
                    <ContextMenuItem inset onClick={onExileClick}>
                        Exile
                    </ContextMenuItem>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
