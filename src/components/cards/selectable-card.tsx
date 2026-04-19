import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { getCardById } from "@convex/cards";

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
    const { gameId, playerId, debugAllActions, pendingCast, pendingTarget } =
        useGameContext();
    const playCard = useMutation(api.game.playCard);
    const announceCast = useMutation(api.game.announceCast);

    const onPlayClick = () => {
        playCard({
            gameId,
            playerId,
            cardInstanceId: cardInstance.id,
            skipValidation: debugAllActions || undefined,
        });
    };

    const onCastClick = (e: React.MouseEvent) => {
        const keepPriority = e.ctrlKey || e.metaKey || undefined;
        // CR 107.3 / 601.2b: if the spell has X in its mana cost, the caster
        // chooses X before announcement. Stay tiny: a native prompt is enough
        // for the study-engine MVP.
        const def = getCardById(cardInstance.card.id);
        const hasX = typeof def.manaCost?.X === "string";
        let chosenX: number | undefined;
        if (hasX) {
            const raw = window.prompt(`Choose X for ${def.name}`, "0");
            if (raw === null) return;
            const parsed = Number.parseInt(raw, 10);
            if (!Number.isFinite(parsed) || parsed < 0) return;
            chosenX = parsed;
        }
        announceCast({
            gameId,
            playerId,
            cardInstanceId: cardInstance.id,
            keepPriority,
            chosenX,
        });
    };

    const onDiscardClick = () => {
        console.log(`Discarding card ${cardInstance.id}`);
    };

    const onExileClick = () => {
        console.log(`Exiling card ${cardInstance.id}`);
    };

    const hasActions =
        allowedActions.length > 0 && !pendingCast && !pendingTarget;

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
