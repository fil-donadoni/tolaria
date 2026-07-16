import { useCallback, useMemo } from "react";
import {
    DragDropProvider,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    type DragEndEvent,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import type { DeckCard } from "~/types/game";
import CardImage from "~/components/cards/card-image";
import DeckPileArea from "~/components/lobby/deck-builder/deck-pile-area";
import CardZoomSlider from "~/components/lobby/deck-builder/card-zoom-slider";
import { useCardZoom } from "~/components/lobby/deck-builder/useCardZoom";
import type {
    CardDragData,
    DropZoneId,
} from "~/components/lobby/deck-builder/dnd-types";

const CARD_BASE = "min(7.5rem, 17vw, 9dvh)";

// Per-zone CSS vars driving `--card-w` / `--card-h` from a zoom multiplier —
// mirrors the catalogue-wide `DeckBuilder`'s zoom wiring (see its
// `zoomVars`/`useCardZoom` usage) so the pool surface behaves the same way.
function zoomVars(mult: number): React.CSSProperties {
    return {
        "--card-w": `calc(${CARD_BASE} * ${mult})`,
        "--card-h": `calc(${CARD_BASE} * ${mult} * 7 / 5)`,
    } as React.CSSProperties;
}

export interface PoolDeckbuilderSurfaceProps {
    /** Cards currently in the Maindeck (Mana-Value grouped piles). */
    mainCards: DeckCard[];
    /** Cards currently in the Sideboard/Pool column. */
    sideCards: DeckCard[];
    /** Move a card from the Maindeck to the Sideboard (click or drag). */
    onMoveToSideboard: (cardId: string) => void;
    /** Move a card from the Sideboard to the Maindeck (click or drag). */
    onMoveToMaindeck: (cardId: string) => void;
    mainTitle?: string;
    sideTitle?: string;
    mainEmptyMessage: string;
    sideEmptyMessage: string;
}

/**
 * Reusable Pool deckbuilder surface (issue #1244, prefactor for PRD #1241):
 * Mana-Value column piles + Sideboard column + drag-and-drop + a per-zone
 * zoom slider, extracted from the post-draft build view
 * (`PoolDeckBuilderForm`) so the draft-time Pool view can mount the same
 * surface later with a Booster panel above it (ADR 0060). State and
 * callbacks only — no build-route-specific coupling (no `eventId`, no
 * persistence).
 */
export default function PoolDeckbuilderSurface({
    mainCards,
    sideCards,
    onMoveToSideboard,
    onMoveToMaindeck,
    mainTitle = "Maindeck",
    sideTitle = "Pool (Sideboard)",
    mainEmptyMessage,
    sideEmptyMessage,
}: PoolDeckbuilderSurfaceProps) {
    // Per-zone card zoom (MTGO-style), namespaced separately from the
    // catalogue-wide `DeckBuilder`'s "main"/"side" zones so the two surfaces
    // persist independent multipliers.
    const mainZoom = useCardZoom({
        zone: "pool-main",
        min: 1,
        max: 2.2,
        initial: 1.25,
    });
    const sideZoom = useCardZoom({
        zone: "pool-side",
        min: 1,
        max: 2.2,
        initial: 1.25,
    });

    const sensors = useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: (e: PointerEvent) =>
                    e.pointerType === "touch"
                        ? [
                              new PointerActivationConstraints.Delay({
                                  value: 250,
                                  tolerance: 10,
                              }),
                          ]
                        : [
                              new PointerActivationConstraints.Distance({
                                  value: 8,
                              }),
                          ],
            }),
            KeyboardSensor,
        ],
        []
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            if (event.canceled) return;
            const source = event.operation?.source;
            const target = event.operation?.target;
            if (!source || !target) return;
            const data = source.data as CardDragData | undefined;
            if (!data) return;
            const dest = target.id as DropZoneId;
            if (data.kind === "main" && dest === "side") {
                onMoveToSideboard(data.cardId);
            } else if (data.kind === "side" && dest === "main") {
                onMoveToMaindeck(data.cardId);
            }
        },
        [onMoveToSideboard, onMoveToMaindeck]
    );

    return (
        <div
            className="flex flex-1 flex-col overflow-hidden"
            style={{ "--card-base": CARD_BASE } as React.CSSProperties}
        >
            <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="grid flex-1 grid-cols-1 divide-x divide-border-subtle/30 overflow-hidden md:grid-cols-2">
                    <div
                        className="h-full overflow-hidden"
                        style={zoomVars(mainZoom.value)}
                    >
                        <DeckPileArea
                            title={mainTitle}
                            zone="main"
                            grouped
                            cards={mainCards}
                            onRemove={onMoveToSideboard}
                            emptyMessage={mainEmptyMessage}
                            headerRight={
                                <CardZoomSlider
                                    value={mainZoom.value}
                                    min={mainZoom.min}
                                    max={mainZoom.max}
                                    onChange={mainZoom.set}
                                    label="Maindeck card size"
                                />
                            }
                        />
                    </div>
                    <div
                        className="h-full overflow-hidden"
                        style={zoomVars(sideZoom.value)}
                    >
                        <DeckPileArea
                            title={sideTitle}
                            zone="side"
                            grouped
                            cards={sideCards}
                            onRemove={onMoveToMaindeck}
                            emptyMessage={sideEmptyMessage}
                            headerRight={
                                <CardZoomSlider
                                    value={sideZoom.value}
                                    min={sideZoom.min}
                                    max={sideZoom.max}
                                    onChange={sideZoom.set}
                                    label="Sideboard card size"
                                />
                            }
                        />
                    </div>
                </div>

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
