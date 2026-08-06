import { useCallback } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import type { DragDropManager } from "@dnd-kit/dom";
import type { CardLookup, DeckColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import CardImage from "~/components/cards/card-image";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import DeckLegalityPanel from "~/components/lobby/deck-builder/deck-legality-panel";
import SaveDeckBar from "~/components/lobby/deck-builder/save-deck-bar";
import DeckBuilderHeader from "./deck-builder-header";
import DeckZonesSurface from "./deck-zones-surface";
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

    mainCards: DeckCard[];
    sideCards: DeckCard[];
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
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <DeckBuilderHeader
                    title={title}
                    backLabel={backLabel}
                    onBack={onDone}
                    actions={headerActions}
                    filters={headerFilters}
                />

                {basicsBar}

                <DragDropProvider
                    manager={manager}
                    sensors={sensors}
                    onDragEnd={handleDragEnd}
                >
                    {sourcePanel && (
                        <div className="min-h-0 flex-1 basis-0 overflow-y-auto border-b border-border-subtle/30">
                            {sourcePanel}
                        </div>
                    )}

                    <div
                        className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden"
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
                                minHeight: `calc(${view.cardBase} * 7 / 5 + 3.5rem)`,
                            } as React.CSSProperties
                        }
                    >
                        <DeckZonesSurface
                            mainCards={mainCards}
                            sideCards={sideCards}
                            layout={layout}
                            lookup={lookup}
                            cardBase={view.cardBase}
                            splitZone={view.splitZone}
                            splitDefault={view.splitDefault}
                            mainZoomZone={view.mainZoomZone}
                            sideZoomZone={view.sideZoomZone}
                            zoomInitial={view.zoomInitial}
                            mainTitle={zones.mainTitle}
                            sideTitle={zones.sideTitle}
                            mainEmptyMessage={zones.mainEmptyMessage}
                            sideEmptyMessage={zones.sideEmptyMessage}
                            sideCountSuffix={zones.sideCountSuffix}
                            sideWarning={zones.sideWarning}
                            onMainCardClick={actions.onMainCardClick}
                            onSideCardClick={actions.onSideCardClick}
                            mainCardTitle={deckCardTitle}
                            sideCardTitle={deckCardTitle}
                            featuredCardId={featured?.cardId}
                            onSetFeatured={featured?.onSet}
                        />
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
                                    <CardImage card={{ id: dragged.cardId }} />
                                </div>
                            );
                        }}
                    </DragOverlay>
                </DragDropProvider>

                {/* short-viewport:hidden (issue #2056 defect 2): this band
                    measured 48px on its own — demoted to `SaveDeckBar`'s
                    compact `DeckLegalityChip`, which only costs height while
                    its disclosure is open. */}
                {legality && (
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
            {saveBar && (
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
                    />
                </div>
            )}

            {overlays}
        </div>
    );
}
