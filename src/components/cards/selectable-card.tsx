import { useRef, useState } from "react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { isSelectableHandChoiceCard } from "~/lib/hand-choice";
import ActionSheet, {
    type ActionSheetItem,
} from "~/components/ui/action-sheet";

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
        playerId,
        pendingCast,
        pendingActivation,
        pendingTarget,
        pendingChoices,
    } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    // Shared commit pipeline — click and drag-to-cast (#254) invoke the same
    // handlers, so the X prompt, mode picker, keep-priority modifier and the
    // dispatched mutation are provably identical across both gestures.
    const {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        phyrexianPickerOverlay,
        costDialogOverlay,
    } = useHandCardCommit(cardInstance);

    // Mid-resolution hand pick (CR 608.2, ADR 0007). Clicks toggle the
    // local buffer; submit fires atomically via the Done button.
    const activeChoice = pendingChoices?.[0];
    const isHandChoice = isSelectableHandChoiceCard(
        activeChoice,
        cardInstance,
        playerId
    );
    const isChoiceSelected =
        isHandChoice && bufferCtx.buffer.includes(cardInstance.id);
    const onChoiceClick = () => {
        if (!activeChoice) return;
        bufferCtx.toggle(cardInstance.id);
    };

    const onDiscardClick = () => {
        console.log(`Discarding card ${cardInstance.id}`);
    };

    const onExileClick = () => {
        console.log(`Exiling card ${cardInstance.id}`);
    };

    const [sheetOpen, setSheetOpen] = useState(false);
    const isTouchRef = useRef(false);

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
                <CardImage card={cardInstance} />
            </div>
        );
    }

    if (!hasActions) {
        return (
            <>
                <CardImage card={cardInstance} />
                {modePickerOverlay}
                {altCostPickerOverlay}
                {phyrexianPickerOverlay}
                {costDialogOverlay}
            </>
        );
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
            <>
                <div className="cursor-pointer" onClick={handler}>
                    <CardImage card={cardInstance} />
                </div>
                {modePickerOverlay}
                {altCostPickerOverlay}
                {phyrexianPickerOverlay}
                {costDialogOverlay}
            </>
        );
    }

    const sheetItems: ActionSheetItem[] = actionEntries.map(
        ({ action, label, handler }) => ({
            key: action,
            label,
            onSelect: handler as (
                e: React.MouseEvent | React.TouchEvent
            ) => void,
        })
    );

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger
                    className="flex items-center justify-center rounded-md border border-dashed text-sm"
                    onTouchStart={() => {
                        isTouchRef.current = true;
                    }}
                    onClick={(e) => {
                        if (isTouchRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            setSheetOpen(true);
                        }
                    }}
                >
                    <CardImage card={cardInstance} />
                </ContextMenuTrigger>

                <ContextMenuContent className="w-fit">
                    {actionEntries.map(({ action, label, handler }) => (
                        <ContextMenuItem key={action} inset onClick={handler}>
                            {label}
                        </ContextMenuItem>
                    ))}
                </ContextMenuContent>
            </ContextMenu>
            <ActionSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                items={sheetItems}
            />
            {modePickerOverlay}
            {altCostPickerOverlay}
            {phyrexianPickerOverlay}
            {costDialogOverlay}
        </>
    );
}
