import { useState } from "react";
import type {
    CardLookup,
    ColumnId,
    DeckColumnLayout,
    GroupingKind,
    OrderingKind,
} from "@convex/deckLayout";
import type { ZoneCard } from "~/types/game";
import { cn } from "~/lib/utils";
import { useViewportMode } from "~/hooks/useViewportMode";
import CardZoomSlider from "~/components/lobby/deck-builder/card-zoom-slider";
import { useCardZoom } from "~/components/lobby/deck-builder/useCardZoom";
import { useSplitRatio } from "~/components/lobby/deck-builder/useSplitRatio";
import {
    usePeekPanelLayout,
    peekPanelReserve,
    PEEK_PANEL_SHEET_RESERVE,
} from "~/components/editing/usePeekPanelLayout";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import DeckZoneSurface from "./deck-zone-surface";
import DeckZonePeek from "./deck-zone-peek";
import PoolSplitDivider from "./pool-split-divider";
import type { DeckZoneSelection } from "./deckZoneSelection";

/** One full-page snap pane of the phone pane strip (issue #2584). The bottom
 *  padding is the Peek Panel's sheet reserve, `0px` while nothing is selected
 *  — a custom property because the pane's PARENT is `display: contents` in
 *  this regime and cannot carry the padding itself. */
const PORTRAIT_PANE =
    "h-full w-full shrink-0 snap-start snap-always overflow-hidden pb-[var(--peek-reserve)]";

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
    /** SHORT zone names (issue #2584) — the Peek Panel's "→" CTA labels. */
    mainTabLabel: string;
    sideTabLabel: string;
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
    /** Presence offers the "★ Featured" CTA on a Maindeck card's Peek Panel /
     *  Inspect Overlay (issue #2584 — it was a per-tile overlay button until
     *  this slice removed those). */
    onSetFeatured?: (cardId: string) => void;
    /** The two zone-to-zone moves, as the Peek Panel's primary CTA. The SAME
     *  handlers a drag resolves to (`deckZoneDrag.ts`), so tapping "→ Side"
     *  and dragging onto the Sideboard can never diverge. */
    onMoveToSideboard: (cardId: string, pinKey?: string) => void;
    onMoveToMaindeck: (cardId: string, pinKey?: string) => void;
    /** Manual-Column management for the MAINDECK (ADR 0075 §2, issue #1626).
     *  Not offered on the Sideboard: its whole pane is one drop target, so a
     *  manual Column there could never receive a card. */
    onAddColumn?: (label: string) => void;
    onRenameColumn?: (columnId: ColumnId, label: string) => void;
    onDeleteColumn?: (columnId: ColumnId) => void;
    /** Records a Card Pin — presence is what puts the Maindeck's Columns on a
     *  selection, i.e. what offers the Peek Panel's `"Move to…"` CTA (issue
     *  #2584, replacing the per-tile menu of #1633). Threaded to the MAINDECK
     *  instance only: the Sideboard is `dropModel: "pane"`, which has no
     *  Columns to pin into. */
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
    mainTabLabel,
    sideTabLabel,
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
    onMoveToSideboard,
    onMoveToMaindeck,
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

    // Issue #2584. Two regimes, one predicate each, both read in JS rather
    // than as a `@custom-variant` (the way `compact-chrome:` is): the pane
    // geometry and `DeckZoneSurface`'s rows-vs-piles branch have to agree, and
    // the only way to make a class contract and a JS branch agree is to have
    // one of them. `index.css`'s `compact-chrome` comment is the record of
    // what the other way costs.
    //
    //  - `touch` (= `compact-chrome:`) — a tap SELECTS a card and the Peek
    //    Panel is the primary move path. On a pointer viewport a click keeps
    //    meaning what it always did.
    //  - `portrait` — the two zones become two full-page snap panes of the
    //    shell's pane strip (`display: contents` hands them straight to it).
    const viewportMode = useViewportMode();
    const touch = viewportMode !== "desktop";
    const portrait = viewportMode === "portrait";

    const [selection, setSelection] = useState<DeckZoneSelection | null>(null);
    // The INSPECTED card is a full selection record, not a bare card id: the
    // overlay's CTA row is derived from it, and deriving that row from
    // `selection` instead — which only a TOUCH tap ever sets — is what left
    // "★ Featured" unreachable at every pointer viewport (PR #2641 review,
    // blocker 2: on desktop the overlay opened with `actions={[]}`).
    const [inspecting, setInspecting] = useState<DeckZoneSelection | null>(
        null
    );
    const peekLayout = usePeekPanelLayout();

    // The panel is `fixed`, so the surface underneath reserves the room it
    // occupies — on the axis the RESOLVED layout actually eats (four of the
    // five UI-gate viewports get the RAIL, i.e. width). The rail reserve goes
    // on this container, which is a real box in that regime; the sheet reserve
    // rides a custom property because in portrait this container is
    // `display: contents` and has no padding of its own to set.
    const reserve = selection ? peekPanelReserve(peekLayout) : undefined;

    // The surface's own CTAs for ONE card, derived from the card itself. Both
    // consumers call it: the Peek Panel (the touch path's selection) and the
    // Inspect Overlay (which a double-click opens at EVERY viewport, with no
    // selection at all). One builder, so the two rows cannot drift and
    // "★ Featured" cannot exist on one and not the other — PRD #589's picker
    // has no other home since this slice took it off the tile.
    const actionsFor = (
        target: DeckZoneSelection
    ): readonly EditingSurfaceAction[] =>
        target.zone === "maindeck"
            ? [
                  {
                      label: `→ ${sideTabLabel}`,
                      primary: true,
                      onSelect: () => {
                          onMoveToSideboard(target.cardId, target.pinKey);
                          setSelection(null);
                      },
                  },
                  ...(onSetFeatured
                      ? [
                            {
                                label: "★ Featured",
                                onSelect: () => onSetFeatured(target.cardId),
                            },
                        ]
                      : []),
              ]
            : [
                  {
                      label: `→ ${mainTabLabel}`,
                      primary: true,
                      onSelect: () => {
                          onMoveToMaindeck(target.cardId, target.pinKey);
                          setSelection(null);
                      },
                  },
              ];

    const peekActions = selection ? actionsFor(selection) : [];
    const inspectActions = inspecting ? actionsFor(inspecting) : [];

    return (
        <div
            ref={splitContainerRef}
            /* `compact-chrome:` (issue #2511): on a phone-shaped viewport this
               pair stops being a fixed-height box that clips. `flex-none` +
               `basis-auto` make it as tall as its two zones actually are, and
               `overflow-visible` stops it cutting the floor the zones' own
               card strips now claim (`deck-zone-surface.tsx`). The shortfall
               then lands in the shell's ONE scroll wrapper — which is what the
               issue asks for: the chrome scrolls, the card list does not
               shrink. Above `md` on a desktop-shaped viewport this is the
               same fixed-height `--split-main` row it always was. */
            className={
                portrait
                    ? // The pair stops being a box at all: its two zones become
                      // direct children of the shell's pane strip, so each is a
                      // full-page snap pane in its own right (issue #2584).
                      // `display: contents` keeps the custom properties below
                      // inheriting — they are what size the tiles.
                      "contents"
                    : "flex min-h-0 flex-1 flex-col overflow-hidden compact-chrome:flex-none compact-chrome:basis-auto compact-chrome:overflow-visible md:flex-row"
            }
            style={
                {
                    "--split-main": `${splitRatio * 100}%`,
                    "--peek-reserve": selection
                        ? PEEK_PANEL_SHEET_RESERVE
                        : "0px",
                    ...(portrait ? undefined : reserve),
                } as React.CSSProperties
            }
        >
            <div
                /* `max-md:` for the flex terms, `compact-chrome:` for the clip
                   (issue #2511). The two halves are deliberately keyed
                   differently: below `md` the pair stacks in a COLUMN, so
                   `flex-none`/`basis-auto` is what gives this zone its content
                   height — while at `md` and up (a landscape phone is 844px
                   WIDE) the pair is a row and the same classes would collapse
                   the zone's WIDTH and fight `md:basis-[var(--split-main)]`.
                   Un-clipping is direction-free, so it takes the full
                   phone-shaped predicate. */
                data-deck-pane="maindeck"
                className={cn(
                    portrait
                        ? PORTRAIT_PANE
                        : "min-h-0 min-w-0 flex-1 overflow-hidden max-md:flex-none max-md:basis-auto compact-chrome:overflow-visible md:flex-none md:shrink-0 md:grow-0 md:basis-[var(--split-main)]"
                )}
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
                    onCardSelect={touch ? setSelection : undefined}
                    selectedTileKey={
                        selection?.zone === "maindeck"
                            ? selection.tileKey
                            : null
                    }
                    onCardInspect={setInspecting}
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
            {/* No split to drag when the zones are separate panes. */}
            {!portrait && <PoolSplitDivider {...splitDividerProps} />}
            <div
                data-deck-pane="sideboard"
                /* Same split as the Maindeck wrapper above (issue #2511). */
                className={cn(
                    portrait
                        ? PORTRAIT_PANE
                        : "min-h-0 min-w-0 flex-1 overflow-hidden max-md:flex-none max-md:basis-auto compact-chrome:overflow-visible"
                )}
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
                    onCardSelect={touch ? setSelection : undefined}
                    selectedTileKey={
                        selection?.zone === "sideboard"
                            ? selection.tileKey
                            : null
                    }
                    onCardInspect={setInspecting}
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

            <DeckZonePeek
                selection={selection}
                subtitle={
                    selection?.zone === "maindeck" ? mainTabLabel : sideTabLabel
                }
                onClose={() => setSelection(null)}
                actions={peekActions}
                onPin={onPin}
                inspecting={inspecting}
                inspectActions={inspectActions}
                onInspect={setInspecting}
                onCloseInspect={() => setInspecting(null)}
            />
        </div>
    );
}
