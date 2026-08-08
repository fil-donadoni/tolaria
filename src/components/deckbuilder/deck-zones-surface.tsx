import type {
    CardLookup,
    ColumnId,
    DeckColumnLayout,
    GroupingKind,
    OrderingKind,
} from "@convex/deckLayout";
import type { ZoneCard } from "~/types/game";
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
    mainCards: ZoneCard[];
    sideCards: ZoneCard[];
    /** Both zones' Column Layouts. */
    layout: DeckColumnLayout;
    /** Per-zone Grouping/Ordering control callbacks (issue #1624) — kept as
     *  separate `onMain*`/`onSide*` pairs, mirroring `onMainCardClick`/
     *  `onSideCardClick` below, rather than a single `(zone, value)` callback:
     *  each `DeckZoneSurface` instance already knows its own zone, so it takes
     *  the un-prefixed form. */
    onMainGroupingChange: (grouping: GroupingKind) => void;
    onSideGroupingChange: (grouping: GroupingKind) => void;
    onMainOrderingChange: (ordering: OrderingKind) => void;
    onSideOrderingChange: (ordering: OrderingKind) => void;
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
    onMainCardClick: (card: ZoneCard) => void;
    onSideCardClick: (card: ZoneCard) => void;
    mainCardTitle: (card: ZoneCard) => string;
    sideCardTitle: (card: ZoneCard) => string;
    featuredCardId?: string | null;
    onSetFeatured?: (cardId: string) => void;
    /** Manual-Column management for the MAINDECK (ADR 0075 §2, issue #1626).
     *  Not offered on the Sideboard: its whole pane is one drop target, so a
     *  manual Column there could never receive a card. */
    onAddColumn?: (label: string) => void;
    onRenameColumn?: (columnId: ColumnId, label: string) => void;
    onDeleteColumn?: (columnId: ColumnId) => void;
    /** Records a Card Pin — presence renders the Maindeck's `"move to…"` card
     *  menu (issue #1633). Threaded to the MAINDECK instance only: the
     *  Sideboard is `dropModel: "pane"`, which has no Columns to pin into. */
    onPin?: (cardId: string, columnId: ColumnId, pinKey: string) => void;
}

export default function DeckZonesSurface({
    mainCards,
    sideCards,
    layout,
    onMainGroupingChange,
    onSideGroupingChange,
    onMainOrderingChange,
    onSideOrderingChange,
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
    onAddColumn,
    onRenameColumn,
    onDeleteColumn,
    onPin,
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
                    onGroupingChange={onMainGroupingChange}
                    onOrderingChange={onMainOrderingChange}
                    lookup={lookup}
                    dropModel="columns"
                    onCardClick={onMainCardClick}
                    cardTitle={mainCardTitle}
                    emptyMessage={mainEmptyMessage}
                    featuredCardId={featuredCardId}
                    onSetFeatured={onSetFeatured}
                    onAddColumn={onAddColumn}
                    onRenameColumn={onRenameColumn}
                    onDeleteColumn={onDeleteColumn}
                    onPin={onPin}
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
                    onGroupingChange={onSideGroupingChange}
                    onOrderingChange={onSideOrderingChange}
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
