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
    const {
        gameId,
        playerId,
        debugAllActions,
        pendingCast,
        pendingActivation,
        pendingTarget,
        pendingChoices,
    } = useGameContext();
    const playCard = useMutation(api.game.playCard);
    const announceCast = useMutation(api.game.announceCast);
    const selectResolutionChoice = useMutation(api.game.selectResolutionChoice);

    // Mid-resolution hand pick (CR 608.2). When the chooser clicks one of
    // their own hand cards during a "keep-hand" step, route to the choice
    // mutation. Already-picked cards are visually distinct and inert.
    const activeChoice = pendingChoices?.[0];
    const isHandChoice =
        !!activeChoice &&
        activeChoice.playerId === playerId &&
        activeChoice.zone === "hand" &&
        cardInstance.ownerId === playerId;
    const isChoiceSelected =
        isHandChoice && activeChoice!.selected.includes(cardInstance.id);
    const onChoiceClick = () => {
        if (!activeChoice || isChoiceSelected) return;
        selectResolutionChoice({
            gameId,
            playerId,
            cardInstanceId: cardInstance.id,
        });
    };

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
        allowedActions.length > 0 &&
        !pendingCast &&
        !pendingActivation &&
        !pendingTarget &&
        !activeChoice;

    if (isHandChoice) {
        const ringClass = isChoiceSelected
            ? "ring-2 ring-emerald-400"
            : "ring-2 ring-violet-400/60 cursor-pointer hover:ring-violet-300";
        return (
            <div
                className={`relative rounded-md ${ringClass}`}
                onClick={onChoiceClick}
            >
                <CardImage card={cardInstance.card} />
            </div>
        );
    }

    if (!hasActions) {
        return <CardImage card={cardInstance.card} />;
    }

    const actionEntries: {
        action: CardAction;
        label: string;
        handler: (e: React.MouseEvent) => void;
    }[] = [];
    if (allowedActions.includes("play"))
        actionEntries.push({
            action: "play",
            label: "Play",
            handler: onPlayClick,
        });
    if (allowedActions.includes("cast"))
        actionEntries.push({
            action: "cast",
            label: "Cast",
            handler: onCastClick,
        });
    if (allowedActions.includes("putToGraveyard"))
        actionEntries.push({
            action: "putToGraveyard",
            label: "Put to graveyard",
            handler: onDiscardClick,
        });
    if (allowedActions.includes("discard"))
        actionEntries.push({
            action: "discard",
            label: "Discard",
            handler: onDiscardClick,
        });
    if (allowedActions.includes("putToExile"))
        actionEntries.push({
            action: "putToExile",
            label: "Exile",
            handler: onExileClick,
        });

    if (actionEntries.length === 1) {
        const { handler } = actionEntries[0];
        return (
            <div className="cursor-pointer" onClick={handler}>
                <CardImage card={cardInstance.card} />
            </div>
        );
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger className="flex items-center justify-center rounded-md border border-dashed text-sm">
                <CardImage card={cardInstance.card} />
            </ContextMenuTrigger>

            <ContextMenuContent className="w-fit">
                {actionEntries.map(({ action, label, handler }) => (
                    <ContextMenuItem key={action} inset onClick={handler}>
                        {label}
                    </ContextMenuItem>
                ))}
            </ContextMenuContent>
        </ContextMenu>
    );
}
