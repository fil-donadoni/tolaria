import type { CardLookup, DeckColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import CardZoomSlider from "~/components/lobby/deck-builder/card-zoom-slider";
import { useCardZoom } from "~/components/lobby/deck-builder/useCardZoom";
import { useSplitRatio } from "~/components/lobby/deck-builder/useSplitRatio";
import DeckZoneSurface from "./deck-zone-surface";
import PoolSplitDivider from "./pool-split-divider";

// Per-zone CSS vars driving `--card-w` / `--card-h` from a zoom multiplier.
function zoomVars(cardBase: string, mult: number): React.CSSProperties {
    return {
        "--card-w": `calc(${cardBase} * ${mult})`,
        "--card-h": `calc(${cardBase} * ${mult} * 7 / 5)`,
    } as React.CSSProperties;
}

/**
 * The Maindeck + Sideboard pair, both rendered through the ONE shared
 * `DeckZoneSurface` (ADR 0075, issue #1622), with the draggable, persisted
 * split between them and a per-zone card-zoom slider. Both builders mount
 * this; only the persistence namespaces, the copy and the Sideboard's cap
 * differ.
 *
 * Deliberately does NOT own the `DragDropProvider`: the Constructed builder's
 * search results are draggable and live OUTSIDE the zones, so the provider
 * belongs to the builder (as it already does for the draft table's Pool). The
 * host wires its `onDragEnd` through the shared `resolveDeckZoneDragAction` /
 * `applyDeckZoneDragAction` pair (`deckZoneDrag.ts`).
 */
export interface DeckZonesSurfaceProps {
    mainCards: DeckCard[];
    sideCards: DeckCard[];
    /** Both zones' Column Layouts. */
    layout: DeckColumnLayout;
    lookup?: CardLookup;
    /** Responsive base card width the zoom multipliers scale (`cardBase()`). */
    cardBase: string;
    /** localStorage namespaces — `useSplitRatio(splitZone)` and
     *  `useCardZoom({ zone })`, kept distinct per builder so the two surfaces
     *  persist independent split and zoom (issue #1622 AC: "the zones'
     *  multipliers still independent"). */
    splitZone: string;
    splitDefault: number;
    mainZoomZone: string;
    sideZoomZone: string;
    zoomInitial: number;
    mainTitle?: string;
    sideTitle?: string;
    mainEmptyMessage: string;
    sideEmptyMessage: string;
    /** Constructed's `0–15` Sideboard cap; Limited leaves both unset (its
     *  Sideboard is uncapped by design, ADR 0054/0055). */
    sideCountSuffix?: string;
    sideWarning?: string | null;
    onMainCardClick: (card: DeckCard) => void;
    onSideCardClick: (card: DeckCard) => void;
    mainCardTitle: (card: DeckCard) => string;
    sideCardTitle: (card: DeckCard) => string;
    featuredCardId?: string | null;
    onSetFeatured?: (cardId: string) => void;
}

export default function DeckZonesSurface({
    mainCards,
    sideCards,
    layout,
    lookup,
    cardBase,
    splitZone,
    splitDefault,
    mainZoomZone,
    sideZoomZone,
    zoomInitial,
    mainTitle = "Maindeck",
    sideTitle = "Sideboard",
    mainEmptyMessage,
    sideEmptyMessage,
    sideCountSuffix,
    sideWarning,
    onMainCardClick,
    onSideCardClick,
    mainCardTitle,
    sideCardTitle,
    featuredCardId,
    onSetFeatured,
}: DeckZonesSurfaceProps) {
    const mainZoom = useCardZoom({
        zone: mainZoomZone,
        min: 1,
        max: 2.2,
        initial: zoomInitial,
    });
    const sideZoom = useCardZoom({
        zone: sideZoomZone,
        min: 1,
        max: 2.2,
        initial: zoomInitial,
    });

    const {
        containerRef: splitContainerRef,
        ratio: splitRatio,
        dividerProps: splitDividerProps,
    } = useSplitRatio(splitZone, splitDefault);

    return (
        <div
            ref={splitContainerRef}
            className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
            style={
                {
                    "--split-main": `${splitRatio * 100}%`,
                } as React.CSSProperties
            }
        >
            <div
                className="min-h-0 min-w-0 flex-1 overflow-hidden md:flex-none md:shrink-0 md:grow-0 md:basis-[var(--split-main)]"
                style={zoomVars(cardBase, mainZoom.value)}
            >
                <DeckZoneSurface
                    zone="maindeck"
                    title={mainTitle}
                    cards={mainCards}
                    layout={layout.maindeck}
                    lookup={lookup}
                    dropModel="columns"
                    onCardClick={onMainCardClick}
                    cardTitle={mainCardTitle}
                    emptyMessage={mainEmptyMessage}
                    featuredCardId={featuredCardId}
                    onSetFeatured={onSetFeatured}
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
            <PoolSplitDivider {...splitDividerProps} />
            <div
                className="min-h-0 min-w-0 flex-1 overflow-hidden"
                style={zoomVars(cardBase, sideZoom.value)}
            >
                <DeckZoneSurface
                    zone="sideboard"
                    title={sideTitle}
                    cards={sideCards}
                    layout={layout.sideboard}
                    lookup={lookup}
                    dropModel="pane"
                    onCardClick={onSideCardClick}
                    cardTitle={sideCardTitle}
                    emptyMessage={sideEmptyMessage}
                    countSuffix={sideCountSuffix}
                    warning={sideWarning}
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
    );
}
