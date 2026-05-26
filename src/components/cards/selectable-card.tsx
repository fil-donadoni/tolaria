import { useState } from "react";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import {
    isClientBufferedKind,
    usePendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { getCardById } from "@convex/cards";

import type { CardAction, CardInstance } from "~/types/game";

import CardImage from "./card-image";
import ModePicker from "./mode-picker";

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
    const bufferCtx = usePendingChoiceBuffer();

    // Mid-resolution hand pick (CR 608.2). When the chooser clicks one of
    // their own hand cards during a hand-zone choice (`discard-hand` or
    // `mulligan-bottom`), route the click to either the client-side buffer
    // (ADR 0007, kinds in `CLIENT_BUFFERED_KINDS`) or the legacy per-click
    // `selectResolutionChoice` mutation. Already-picked cards are visually
    // distinct; clicking a buffered selection deselects it.
    const activeChoice = pendingChoices?.[0];
    const isHandChoice =
        !!activeChoice &&
        activeChoice.playerId === playerId &&
        activeChoice.zone === "hand" &&
        cardInstance.ownerId === playerId;
    const isBufferedChoice =
        isHandChoice && isClientBufferedKind(activeChoice!.kind);
    const isChoiceSelected =
        isHandChoice &&
        (isBufferedChoice
            ? bufferCtx.buffer.includes(cardInstance.id)
            : activeChoice!.selected.includes(cardInstance.id));
    const onChoiceClick = () => {
        if (!activeChoice) return;
        if (isBufferedChoice) {
            bufferCtx.toggle(cardInstance.id);
            return;
        }
        if (isChoiceSelected) return;
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

    const [modePickerState, setModePickerState] = useState<{
        chosenX: number | undefined;
        keepPriority: boolean | undefined;
        position: { x: number; y: number };
    } | null>(null);

    function commitAnnounceCast(args: {
        chosenX: number | undefined;
        keepPriority: boolean | undefined;
        chosenModeId: string | undefined;
    }) {
        announceCast({
            gameId,
            playerId,
            cardInstanceId: cardInstance.id,
            keepPriority: args.keepPriority,
            chosenX: args.chosenX,
            chosenModeId: args.chosenModeId,
        });
    }

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
        // CR 700.2 — modal spell: pick a mode before announcement.
        if (def.modes && def.modes.length > 0) {
            // Anchor on currentTarget (the handler-bound element) — more
            // stable than `e.target` which may be a nested child. Falls
            // back to the click coords if the rect is degenerate.
            const anchor = e.currentTarget as HTMLElement | null;
            const rect = anchor?.getBoundingClientRect();
            const position =
                rect && rect.width > 0 && rect.height > 0
                    ? { x: rect.right + 8, y: rect.top }
                    : { x: e.clientX + 8, y: e.clientY + 8 };
            setModePickerState({
                chosenX,
                keepPriority,
                position,
            });
            return;
        }
        commitAnnounceCast({
            chosenX,
            keepPriority,
            chosenModeId: undefined,
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

    const def = getCardById(cardInstance.card.id);
    const modePickerOverlay =
        modePickerState && def.modes ? (
            <ModePicker
                modes={def.modes}
                cardName={def.name}
                variant="portal"
                position={modePickerState.position}
                onSelect={(modeId) => {
                    const { chosenX, keepPriority } = modePickerState;
                    setModePickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: modeId,
                    });
                }}
                onCancel={() => setModePickerState(null)}
            />
        ) : null;

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
            </>
        );
    }

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger className="flex items-center justify-center rounded-md border border-dashed text-sm">
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
            {modePickerOverlay}
        </>
    );
}
