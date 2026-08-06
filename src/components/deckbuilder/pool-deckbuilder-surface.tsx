import { useCallback } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import type { DragDropManager } from "@dnd-kit/dom";
import type { ColumnId, DeckColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import CardImage from "~/components/cards/card-image";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import { cardBase } from "~/lib/cardSizing";
import DeckZonesSurface from "./deck-zones-surface";
import {
    applyDeckZoneDragAction,
    resolveDeckZoneDragAction,
} from "./deckZoneDrag";
import { useDeckDragSensors } from "./useDeckDragSensors";

// Floored at CARD_MIN_W (issue #2056) so a short-and-wide viewport (landscape
// phone, split-screen tablet) can't collapse the `9dvh` term past legibility.
const CARD_BASE = cardBase("7.5rem", "17vw", "9dvh");

export interface PoolDeckbuilderSurfaceProps {
    /** Cards currently in the Maindeck. */
    mainCards: DeckCard[];
    /** Cards currently in the Sideboard/Pool zone. */
    sideCards: DeckCard[];
    /** Both zones' Column Layouts. The Maindeck's `pins` are the seat's Pool
     *  Arrangement Card Pins, read live (issue #1621/#1622). */
    layout: DeckColumnLayout;
    /** Move a card from the Maindeck to the Sideboard (click or drag). */
    onMoveToSideboard: (cardId: string) => void;
    /** Move a card from the Sideboard to the Maindeck (click or drag). */
    onMoveToMaindeck: (cardId: string) => void;
    /** Record a Card Pin for `cardId` — fired when a Maindeck card is dragged
     *  to another Column, or a Sideboard card is dragged onto a Column (the
     *  second half of that one-gesture move). Persisted on the seat's Pool
     *  Arrangement (ADR 0075 §4). */
    onPin: (cardId: string, columnId: ColumnId) => void;
    mainTitle?: string;
    sideTitle?: string;
    mainEmptyMessage: string;
    sideEmptyMessage: string;
    /** dnd-kit manager. Omitted in the app (the provider makes its own); the
     *  mounted drag test injects one so it can drive REAL drag operations
     *  against the REAL droppable registry — jsdom has no layout, so a
     *  pointer-driven drag can never resolve a drop target there. */
    manager?: DragDropManager;
}

/**
 * The Limited builder's deck surface (issue #1244, PRD #1241; rebuilt on the
 * shared zone surface in issue #1622). It now owns only what is
 * Limited-specific — the drag context, the copy, and the callbacks — while the
 * Maindeck and Sideboard themselves are the SAME `DeckZoneSurface` the
 * Constructed builder mounts, driven by the SAME Column Layout engine.
 * Nothing user-visible changed here: the fixed Lands + MV 0..7+ ladder, the
 * per-column drop targets, the draggable split and the two independent zoom
 * sliders are all reproduced by the shared surface.
 */
export default function PoolDeckbuilderSurface({
    mainCards,
    sideCards,
    layout,
    onMoveToSideboard,
    onMoveToMaindeck,
    onPin,
    mainTitle = "Maindeck",
    sideTitle = "Pool (Sideboard)",
    mainEmptyMessage,
    sideEmptyMessage,
    manager,
}: PoolDeckbuilderSurfaceProps) {
    const sensors = useDeckDragSensors();

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            if (event.canceled) return;
            const target = event.operation?.target;
            const action = resolveDeckZoneDragAction(
                event.operation?.source?.data as CardDragData | undefined,
                target === null || target === undefined
                    ? undefined
                    : String(target.id)
            );
            if (!action) return;
            applyDeckZoneDragAction(action, {
                onMoveToSideboard,
                onMoveToMaindeck,
                onPin,
            });
        },
        [onMoveToSideboard, onMoveToMaindeck, onPin]
    );

    return (
        <div
            className="flex flex-1 flex-col overflow-hidden"
            style={
                {
                    "--card-base": CARD_BASE,
                    // Issue #2056 defect 3 amplification: this pane's own
                    // `overflow-hidden` triggers the CSS flexbox
                    // automatic-minimum-size-ZERO exception (an item with
                    // `overflow` other than `visible` gets an automatic
                    // minimum of 0, not its content's min-content size), so
                    // `flex-1` alone let it collapse to a measured 0px once
                    // the sibling chrome bands (header/basics/legality/save)
                    // ate the whole budget — "clientHeight: 0" in the
                    // browser measurement, 0 card tiles visible. An explicit
                    // `min-height` overrides that automatic default, and
                    // ties the floor to the SAME floored `--card-base`
                    // defect 1 already fixed (one card row's height, its 5:7
                    // aspect ratio) plus the pile's own header/padding
                    // (~3.5rem — the zone surface's title row) — rather than
                    // a second, unrelated hardcoded number. Below this floor
                    // the zones' OWN internal scrollers take over, so a real
                    // space shortfall scrolls instead of collapsing.
                    minHeight: `calc(${CARD_BASE} * 7 / 5 + 3.5rem)`,
                } as React.CSSProperties
            }
        >
            <DragDropProvider
                manager={manager}
                sensors={sensors}
                onDragEnd={handleDragEnd}
            >
                <DeckZonesSurface
                    mainCards={mainCards}
                    sideCards={sideCards}
                    layout={layout}
                    cardBase={CARD_BASE}
                    splitZone="pool"
                    splitDefault={2 / 3}
                    mainZoomZone="pool-main"
                    sideZoomZone="pool-side"
                    zoomInitial={1.0}
                    mainTitle={mainTitle}
                    sideTitle={sideTitle}
                    mainEmptyMessage={mainEmptyMessage}
                    sideEmptyMessage={sideEmptyMessage}
                    onMainCardClick={(card) => onMoveToSideboard(card.cardId)}
                    onSideCardClick={(card) => onMoveToMaindeck(card.cardId)}
                    mainCardTitle={(card) =>
                        `Remove ${card.cardName} (drag to move zone)`
                    }
                    sideCardTitle={(card) =>
                        `Remove ${card.cardName} (drag to move zone)`
                    }
                />

                <DragOverlay dropAnimation={null}>
                    {(source) => {
                        const d = source.data as CardDragData;
                        return (
                            <div
                                className="aspect-5/7"
                                style={{ width: `calc(${CARD_BASE} * 1.1)` }}
                            >
                                <CardImage card={{ id: d.cardId }} />
                            </div>
                        );
                    }}
                </DragOverlay>
            </DragDropProvider>
        </div>
    );
}
