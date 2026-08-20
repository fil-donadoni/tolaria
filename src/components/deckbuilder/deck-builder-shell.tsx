import { useCallback, useRef, useState } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import type { DragDropManager } from "@dnd-kit/dom";
import type { CardLookup, DeckColumnLayout } from "@convex/deckLayout";
import type { ZoneCard } from "~/types/game";
import { cn } from "~/lib/utils";
import { useViewportMode } from "~/hooks/useViewportMode";
import { useDeckSourceDock } from "~/hooks/useDeckSourceDock";
import { Button } from "~/components/ui/button";
import CardImage from "~/components/cards/card-image";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import DeckLegalityPanel from "~/components/lobby/deck-builder/deck-legality-panel";
import SaveDeckBar from "~/components/lobby/deck-builder/save-deck-bar";
import DeckBuilderHeader from "./deck-builder-header";
import DeckZonesSurface from "./deck-zones-surface";
import DeckPaneTabs from "./deck-pane-tabs";
import DeckBottomBar from "./deck-bottom-bar";
import DeckFeaturedSelect from "./deck-featured-select";
import DeckBasicsSheet from "./deck-basics-sheet";
import { deckPanes, type DeckPane } from "./deckPanes";
import {
    applyDeckZoneDragAction,
    resolveDeckZoneDragAction,
} from "./deckZoneDrag";
import {
    deckCardTitle,
    type DeckBuilderSlots,
    type DeckBuilderViewSpec,
    type DeckLegalitySpec,
    type DeckSaveBarSpec,
    type DeckZoneActions,
    type DeckZonePresentation,
    type FeaturedCardSpec,
} from "./deckBuilderVariant";
import { useDeckDragSensors } from "./useDeckDragSensors";

export interface DeckBuilderShellProps extends DeckBuilderSlots {
    /** Header heading, e.g. `Edit Deck` / `Build Limited Deck`. */
    title: string;
    /** Back affordance label; the header button and `SaveDeckBar`'s
     *  short-viewport twin are rendered from this one string. */
    backLabel?: string;
    /** Back AND Done are the same action in every variant: flush, then leave. */
    onDone: () => void;

    mainCards: ZoneCard[];
    sideCards: ZoneCard[];
    /** Both zones' Column Layouts. */
    layout: DeckColumnLayout;
    /** Catalogue lookup handed to the Column Layout engine (ADR 0080). */
    lookup?: CardLookup;
    zones: DeckZonePresentation;
    actions: DeckZoneActions;
    featured?: FeaturedCardSpec;
    view: DeckBuilderViewSpec;
    legality?: DeckLegalitySpec;
    saveBar?: DeckSaveBarSpec;

    /** dnd-kit manager. Omitted in the app (the provider makes its own); the
     *  mounted drag tests inject one so they can drive REAL drag operations
     *  against the REAL droppable registry — jsdom has no layout, so a
     *  pointer-driven drag can never resolve a drop target there. */
    manager?: DragDropManager;
}

/**
 * THE deckbuilder screen (ADR 0075 §1, PRD #1617, issue #1623) — ONE shell
 * rendering the whole surface for every variant. It owns the header band, the
 * source-panel slot, both zone surfaces, the split divider, the drag context
 * and overlay, the legality panel and the save bar. The Constructed and
 * Limited entry points are thin wrappers supplying their source panel, their
 * persistence sinks (through `useDeckWorkspace`) and their legality.
 *
 * **This component never branches on which builder it is rendering for.**
 * There is no `variant` / `isLimited` / `kind` prop and no `kind ===` check
 * inside; every difference arrives as a slot or as data (see
 * `deckBuilderVariant.ts` for the full vocabulary and the three variants it
 * covers). The conditionals below all read slot/data PRESENCE — "was a source
 * panel supplied", "is there a save bar" — which the shell can answer without
 * knowing anything about its caller, and which a third variant inherits for
 * free.
 *
 * Layout is the shape issue #2275 established for the Limited route, applied
 * to both: ONE scrollable wrapper holds everything that can outgrow its box
 * (header, basics bar, source panel, zone pane, legality panel), and
 * `SaveDeckBar` sits OUTSIDE it as a `shrink-0` sibling, so a viewport too
 * short for the zone pane's floor scrolls instead of pushing the save bar out
 * of the flex column. The route root claims the shell's REMAINING height
 * (`flex-1 min-h-0`), never a whole viewport (issue #2056 defect 3).
 */
export default function DeckBuilderShell({
    title,
    backLabel = "← Back",
    onDone,
    headerActions,
    headerFoldableActions,
    headerFilters,
    sourcePanel,
    basicsBar,
    overlays,
    mainCards,
    sideCards,
    layout,
    lookup,
    zones,
    actions,
    featured,
    view,
    legality,
    saveBar,
    manager,
}: DeckBuilderShellProps) {
    const sensors = useDeckDragSensors();

    // Issue #2584 — the two phone regimes, read in JS so the pane geometry and
    // `DeckZoneSurface`'s rows-vs-piles branch cannot disagree (the same
    // reasoning `deck-zones-surface.tsx` records at its own `useViewportMode`
    // call). `compact` is exactly the `compact-chrome:` variant's predicate.
    const viewportMode = useViewportMode();
    const compact = viewportMode !== "desktop";
    const portrait = viewportMode === "portrait";

    // Review finding #3 (PR #2653, issue #2585): the source-panel dock frees
    // the zones pane's whole column height, but the applied-filter tag row
    // (#2650) still grows the header band ~58px the moment a search is
    // active — 1180x820's deck pane drops from 62.6% to 55.5%, under the
    // issue's 60% floor. The header has no slack to absorb that (row 1 is
    // already edge-to-edge at 1180px — measured, not assumed): the ONLY
    // reclaimable chrome at that viewport is the ADD BASIC bar's fixed 57px,
    // so it moves into the SAME sheet portrait already uses (`DeckBasicsSheet`
    // below), gated on `sourcePanel` presence the same way finding #5 gates
    // the strip wrapper — this predicate alone says nothing about whether a
    // source panel exists, and reused bare it would fold Limited's bar too,
    // on a surface the ui-gate lane never walks.
    const dockActive = useDeckSourceDock();
    const isSourceDock = Boolean(sourcePanel) && dockActive;

    const mainTabLabel = zones.mainTabLabel ?? "Main";
    const sideTabLabel = zones.sideTabLabel ?? "Side";

    // The pane SET falls out of which slots this variant supplied — three for
    // a builder with a source panel, two for one whose zones are the only
    // source. No `kind` check anywhere (`deckPanes.ts`).
    const panes = deckPanes({
        source: sourcePanel
            ? { label: sourcePanel.label, count: sourcePanel.count }
            : undefined,
        mainLabel: mainTabLabel,
        mainCount: mainCards.length,
        sideLabel: sideTabLabel,
        sideCount: sideCards.length,
    });

    const stripRef = useRef<HTMLDivElement | null>(null);
    const [activePaneId, setActivePaneId] = useState<string>(panes[0]!.id);
    const [basicsOpen, setBasicsOpen] = useState(false);

    // Tapping a tab scrolls its pane into view — a programmatic swipe in
    // portrait (where the panes are a snap-scroller) and a plain scroll in
    // landscape (where they are already side by side). Queried out of the DOM
    // rather than held as refs because the panes are rendered by three
    // different components, one of which (`DeckZonesSurface`) owns two of them.
    const handleSelectPane = useCallback((pane: DeckPane) => {
        setActivePaneId(pane.id);
        document
            .querySelector(`[data-deck-pane="${pane.id}"]`)
            ?.scrollIntoView({ inline: "start", block: "nearest" });
    }, []);

    // Which pane the snap-scroller has landed on, so the tab highlight follows
    // a SWIPE and not only a tap.
    const handleStripScroll = useCallback(() => {
        const strip = stripRef.current;
        if (!strip || strip.clientWidth === 0) return;
        const index = Math.round(strip.scrollLeft / strip.clientWidth);
        const pane = panes[Math.min(Math.max(index, 0), panes.length - 1)];
        if (pane) setActivePaneId(pane.id);
    }, [panes]);

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
            applyDeckZoneDragAction(action, actions);
        },
        [actions]
    );

    return (
        <div className="flex flex-1 min-h-0 flex-col bg-surface-base text-text">
            <div
                className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    // In portrait the screen is a FIXED column — header, tabs,
                    // pane strip, bottom bar — because a full-page snap pane
                    // has to be exactly one viewport tall. Everywhere else it
                    // stays the ONE scroll wrapper issue #2275/#2511 built.
                    portrait ? "overflow-hidden" : "overflow-y-auto"
                )}
            >
                <DeckBuilderHeader
                    title={title}
                    backLabel={backLabel}
                    onBack={onDone}
                    actions={headerActions}
                    foldableActions={headerFoldableActions}
                    filters={headerFilters}
                />

                {/* The basics bar moves into a SHEET on a phone (issue #2584):
                    five steppers plus an art picker is a permanent band the
                    card panes cannot spare. `Lands` on the bottom bar opens
                    it. Review finding #3 (#2585/PR #2653) reuses the SAME
                    sheet in the dock layout: the 57px inline band is the one
                    chrome lever left to reclaim once a search is active (the
                    header has no spare width to keep the tag row on its own
                    row — measured edge-to-edge at 1180px), so it folds down
                    to this one small trigger there too. */}
                {basicsBar && !portrait && !isSourceDock && basicsBar}
                {basicsBar && isSourceDock && (
                    <div className="shrink-0 px-4 md:px-6">
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setBasicsOpen(true)}
                        >
                            Add Basic
                        </Button>
                    </div>
                )}

                <DragDropProvider
                    manager={manager}
                    sensors={sensors}
                    onDragEnd={handleDragEnd}
                >
                    {/* Tabs render on every phone-shaped viewport, not only in
                        portrait: in landscape the panes are already side by
                        side, but a tab is still the only DROP TARGET that can
                        reach a pane the player is not looking at. */}
                    {compact && (
                        <DeckPaneTabs
                            panes={panes}
                            activeId={activePaneId}
                            onSelect={handleSelectPane}
                        />
                    )}

                    <div
                        ref={stripRef}
                        onScroll={portrait ? handleStripScroll : undefined}
                        // `contents` outside portrait: the wrapper vanishes and
                        // the source panel and the zones pane stay the direct
                        // flex children of the scroll wrapper they have always
                        // been — zero layout change off the phone. In portrait
                        // it becomes the horizontal snap-scroller the panes
                        // live in.
                        //
                        // `deck-source-dock:` (issue #2585) overrides `contents`
                        // back to a real flex-ROW box at landscape-and-roomy
                        // widths (tablet-landscape 1180×820, desktop 1440×900):
                        // the source panel below stops sharing height 50/50 with
                        // the zones pane and becomes a bounded-width side dock,
                        // so the zones pane inherits the row's WHOLE height
                        // instead of half of it (`src/index.css` has the
                        // arithmetic for why only a WIDTH split reaches the
                        // AC's 60% at 1180×820). No-op everywhere else — the
                        // variant's media query does not match, so `contents`
                        // still applies and this box never exists.
                        //
                        // Gated on `sourcePanel` (review finding #5): with no
                        // source panel (Limited builder) there is only one
                        // child left in this wrapper, so turning it into a flex
                        // row still changes the zones pane from a direct flex
                        // item of the shell column to the sole child of a new
                        // row — geometrically equivalent at the AC viewports
                        // but not actually "untouched", and it would carry
                        // finding #1's axis trap into a surface the ui-gate
                        // lane never walks (`limited-build` is UNWALKED). Keep
                        // Limited on plain `contents` so the claim is true, not
                        // just equivalent.
                        className={
                            portrait
                                ? "flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
                                : sourcePanel
                                  ? "contents deck-source-dock:flex deck-source-dock:min-h-0 deck-source-dock:flex-1 deck-source-dock:flex-row"
                                  : "contents"
                        }
                    >
                        {sourcePanel && (
                            <div
                                data-deck-pane="source"
                                // `deck-source-dock:` (issue #2585): a bounded
                                // WIDTH instead of an equal HEIGHT share.
                                // `flex-none` overrides the `flex-1 basis-0`
                                // base so the panel stops growing to fill half
                                // the (now horizontal) row; `overflow-y-auto`
                                // stays, so the dock is a genuinely scrollable
                                // results list, not a clipped strip — the row's
                                // default `align-items: stretch` gives it the
                                // row's FULL height (the same height the zones
                                // pane gets), just a fixed width instead. The
                                // divider moves from the bottom edge to the
                                // trailing edge to match.
                                //
                                // A scroll port needs a keyboard way to scroll
                                // it (axe `scrollable-region-focusable`, WCAG
                                // 2.1.1): the pane's tiles are focusable when
                                // the pool has cards, but at phone landscape
                                // the visible band held none and the region
                                // became unreachable without a pointer. A tab
                                // stop on the port itself is unconditional and
                                // is what the rule asks for. `role="region"` +
                                // a name so the stop announces as something
                                // rather than as a bare group (issue #2593).
                                tabIndex={0}
                                role="region"
                                aria-label="Card source"
                                className={
                                    portrait
                                        ? "h-full w-full shrink-0 snap-start snap-always overflow-y-auto"
                                        : "min-h-0 flex-1 basis-0 overflow-y-auto border-b border-border-subtle/30 deck-source-dock:w-[22rem] deck-source-dock:max-w-[38%] deck-source-dock:flex-none deck-source-dock:self-stretch deck-source-dock:border-b-0 deck-source-dock:border-r"
                                }
                            >
                                {sourcePanel.content}
                            </div>
                        )}

                        <div
                            // `compact-chrome:` (issue #2511): on a phone-shaped
                            // viewport this pane stops rationing a fixed budget
                            // among bands that cannot all fit. `flex-none` +
                            // `basis-auto` size it to the zones inside, and
                            // `overflow-visible` stops it clipping their card
                            // floor; the wrapper directly above — the ONE
                            // scrollable ancestor everything on this screen sits
                            // in — absorbs the overflow, so no control is ever
                            // stranded outside a scroller. Above `md` on a
                            // desktop-shaped viewport nothing here changes.
                            // `contents` in portrait (issue #2584): the zones pane
                            // stops being a box so its two zones become panes of
                            // the strip above in their own right. Custom
                            // properties still inherit through it, which is all
                            // this element was ever contributing there.
                            //
                            // `deck-source-dock:` (issue #2585): no override
                            // needed here. `flex-1 basis-0` is axis-agnostic —
                            // once the strip wrapper above turns into a row, this
                            // pane grows along the ROW's main axis (width)
                            // instead of the column's (height), and `flex-col`
                            // keeps arranging ITS OWN children vertically either
                            // way. The row's default `align-items: stretch`
                            // hands it the row's full height for free.
                            className={
                                portrait
                                    ? "contents"
                                    : "flex min-h-0 flex-1 basis-0 flex-col overflow-hidden compact-chrome:flex-none compact-chrome:basis-auto compact-chrome:overflow-visible"
                            }
                            style={
                                {
                                    "--card-base": view.cardBase,
                                    // Issue #2056 defect 3 amplification: this
                                    // pane's own `overflow-hidden` triggers the CSS
                                    // flexbox automatic-minimum-size-ZERO exception
                                    // (an item whose `overflow` is not `visible`
                                    // gets an automatic minimum of 0, not its
                                    // content's min-content size), so `flex-1`
                                    // alone let it collapse to a measured 0px once
                                    // the sibling chrome bands ate the whole
                                    // budget. An explicit `min-height` overrides
                                    // that default, tied to the SAME floored
                                    // `--card-base` (one card row at its 5:7 aspect
                                    // ratio) plus the zone surface's own title row
                                    // (~3.5rem) rather than a second unrelated
                                    // hardcoded number. Below this floor the zones'
                                    // OWN scrollers, and the wrapper above, absorb
                                    // the shortfall.
                                    minHeight: portrait
                                        ? undefined
                                        : `calc(${view.cardBase} * 7 / 5 + 3.5rem)`,
                                } as React.CSSProperties
                            }
                        >
                            <DeckZonesSurface
                                mainCards={mainCards}
                                sideCards={sideCards}
                                layout={layout}
                                onMainGroupingChange={
                                    actions.onMainGroupingChange
                                }
                                onSideGroupingChange={
                                    actions.onSideGroupingChange
                                }
                                onMainOrderingChange={
                                    actions.onMainOrderingChange
                                }
                                onSideOrderingChange={
                                    actions.onSideOrderingChange
                                }
                                lookup={lookup}
                                onAddColumn={actions.onAddColumn}
                                onRenameColumn={actions.onRenameColumn}
                                onDeleteColumn={actions.onDeleteColumn}
                                onPin={actions.onPin}
                                cardBase={view.cardBase}
                                splitZone={view.splitZone}
                                splitDefault={view.splitDefault}
                                mainZoomZone={view.mainZoomZone}
                                sideZoomZone={view.sideZoomZone}
                                zoomInitial={view.zoomInitial}
                                mainTitle={zones.mainTitle}
                                sideTitle={zones.sideTitle}
                                mainTabLabel={mainTabLabel}
                                sideTabLabel={sideTabLabel}
                                mainEmptyMessage={zones.mainEmptyMessage}
                                sideEmptyMessage={zones.sideEmptyMessage}
                                sideCountSuffix={zones.sideCountSuffix}
                                sideWarning={zones.sideWarning}
                                onMainCardClick={actions.onMainCardClick}
                                onSideCardClick={actions.onSideCardClick}
                                onMoveToSideboard={actions.onMoveToSideboard}
                                onMoveToMaindeck={actions.onMoveToMaindeck}
                                mainCardTitle={deckCardTitle}
                                sideCardTitle={deckCardTitle}
                                featuredCardId={featured?.cardId}
                                onSetFeatured={featured?.onSet}
                            />
                        </div>
                    </div>

                    <DragOverlay dropAnimation={null}>
                        {(source) => {
                            const dragged = source.data as CardDragData;
                            return (
                                <div
                                    className="aspect-5/7"
                                    style={{
                                        width: `calc(${view.cardBase} * 1.1)`,
                                    }}
                                >
                                    <CardImage
                                        card={{ id: dragged.cardId }}
                                        holdPreview={false}
                                    />
                                </div>
                            );
                        }}
                    </DragOverlay>
                </DragDropProvider>

                {/* short-viewport:hidden (issue #2056 defect 2): this band
                    measured 48px on its own — demoted to `SaveDeckBar`'s
                    compact `DeckLegalityChip`, which only costs height while
                    its disclosure is open. */}
                {legality && !portrait && (
                    <div className="short-viewport:hidden">
                        <DeckLegalityPanel
                            formatLabel={legality.formatLabel}
                            isLegal={legality.isLegal}
                            reasons={legality.reasons}
                        />
                    </div>
                )}
            </div>

            {/* shrink-0 (issue #2275): a plain flex item's default
                `flex-shrink: 1` would let the wrapper above's overflow squeeze
                this one too once the outer column ran out of room. It never
                needs to — the wrapper absorbs the shortfall — but `shrink-0`
                makes that guarantee explicit rather than incidental. */}
            {/* The phone bottom bar (issue #2584) REPLACES `SaveDeckBar` in
                portrait — it carries everything that bar carried (name, count,
                Delete, Done) plus the pips, the mini curve and the Lands /
                Stats entries, in the same band budget. Two bottom bands is the
                chrome cost issue #2511 spent a slice reclaiming. */}
            {portrait && (
                <DeckBottomBar
                    mainCards={mainCards}
                    sideCards={sideCards}
                    mainLabel={mainTabLabel}
                    sideLabel={sideTabLabel}
                    onOpenLands={
                        basicsBar ? () => setBasicsOpen(true) : undefined
                    }
                    onDone={onDone}
                    legality={legality}
                    saveBar={saveBar}
                />
            )}

            <DeckBasicsSheet
                open={basicsOpen && (portrait || isSourceDock)}
                onClose={() => setBasicsOpen(false)}
            >
                {basicsBar}
            </DeckBasicsSheet>

            {saveBar && !portrait && (
                <div className="shrink-0">
                    <SaveDeckBar
                        name={saveBar.name}
                        onChangeName={saveBar.onChangeName}
                        onDone={onDone}
                        onDelete={saveBar.onDelete}
                        cardCount={saveBar.cardCount}
                        onBack={onDone}
                        backLabel={backLabel}
                        legality={legality}
                        // Issue #1631 fixup R-F7: defaults to
                        // `headerFoldableActions` when the caller passes ONE
                        // control to both slots (the pool builder's
                        // `statsAction`/`compactStatsAction` pair still wins
                        // when they differ, e.g. R-F6's compact className) —
                        // so a future caller that supplies
                        // `headerFoldableActions` and forgets this twin does
                        // not silently lose the control at short viewport.
                        foldableActions={
                            saveBar.foldableActions ?? headerFoldableActions
                        }
                        // Issue #2584: `★ Featured`'s pointer home. The Peek
                        // Panel carries the same CTA for a finger, but the
                        // Peek Panel only ever opens from a TAP — so without
                        // this the picker would be unreachable with a mouse,
                        // which is how the per-card overlay button used to be
                        // reached. A deck-level control for deck-level
                        // metadata; the tile has no spare gesture to give it
                        // (`deck-card-tile.tsx`).
                        featured={
                            featured && (
                                <DeckFeaturedSelect
                                    cards={mainCards}
                                    explicitCardId={featured.explicitCardId}
                                    onSet={featured.onSet}
                                />
                            )
                        }
                    />
                </div>
            )}

            {overlays}
        </div>
    );
}
