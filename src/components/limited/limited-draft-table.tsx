import { useState } from "react";
import {
    DragDropProvider,
    DragOverlay,
    type DragEndEvent,
} from "@dnd-kit/react";
import { type DragDropManager } from "@dnd-kit/dom";
import type { Id } from "@convex/_generated/dataModel";
import {
    useLimitedEventMutations,
    type LimitedEventSeatView,
} from "~/hooks/useLimitedEvent";
import CardImage from "~/components/cards/card-image";
import { Banner } from "@/components/ui/banner";
import CardZoomSlider from "~/components/lobby/deck-builder/card-zoom-slider";
import { useCardZoom } from "~/components/lobby/deck-builder/useCardZoom";
import { useDeckDragSensors } from "~/components/deckbuilder/useDeckDragSensors";
import PeekPanel from "~/components/editing/peek-panel";
import InspectOverlay from "~/components/editing/inspect-overlay";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import { cardBase } from "~/lib/cardSizing";
import LimitedDraftPack from "./limited-draft-pack";
import LimitedDraftTimer from "./limited-draft-timer";
import LimitedDraftPool from "./limited-draft-pool";
import LimitedPickContextMenu, {
    type LimitedPickContextMenuState,
} from "./limited-pick-context-menu";
import {
    poolArrangementPatch,
    resolveDraftDragAction,
    type DraftDragData,
} from "./limitedDraftDrag";
import type { ColumnId } from "@convex/deckLayout";

// Same responsive base size as the shared pool deckbuilder surface / draft
// pack (`CARD_BASE` in `pool-deck-builder-form.tsx` / `limited-draft-pack.tsx`),
// floored at CARD_MIN_W (issue #2056) so a short-and-wide viewport can't
// collapse the drag-overlay tile past legibility.
const CARD_BASE = cardBase("7.5rem", "17vw", "9dvh");

/** The Draft table (PRD #1107 stories 10-13, issue #1112; pick gestures +
 *  Selected Card per ADR 0060, issue #1248): the Booster in front of the
 *  viewer and the viewer's accumulated Pool so far, sharing ONE
 *  `DragDropProvider` so a Booster card can be dragged straight into a Pool
 *  Column or the Sideboard (`LimitedDraftPool` mounts the shared
 *  `DeckZoneSurface`, whose Columns and Sideboard pane register their own
 *  `useDroppable` targets as descendants of this provider — see
 *  `limitedDraftDrag.ts`'s module doc comment).
 *
 *  Gestures:
 *  - single click on a Booster card → SELECTS it (`selectDraftPick`),
 *    never commits.
 *  - double click / the context-menu "Pick" / a drag onto a Pool Column →
 *    commits the Pick into its automatic Column (or the dropped-on Column,
 *    for a drag onto a SPECIFIC one — any Column the current Grouping
 *    generates, issue #1632).
 *  - the context-menu "Pick to sideboard" / a drag onto the Sideboard →
 *    commits the Pick AND parks the new Pool card in the Sideboard, in one
 *    user gesture.
 *  - Pool ⇄ Sideboard / between Columns: drag OR click
 *    (`LimitedDraftPool`'s own tiles), persisted via `setPoolArrangementEntry`. */
export default function LimitedDraftTable({
    eventId,
    seat,
    round,
    totalRounds,
    manager,
}: {
    eventId: Id<"limitedEvents">;
    seat: LimitedEventSeatView;
    round: number;
    totalRounds: number;
    /** dnd-kit manager, forwarded to this screen's own `DragDropProvider`.
     *  Omitted in the app (the provider makes its own); the mounted drag tests
     *  inject one so they can drive REAL drag operations against the REAL
     *  droppable registry — jsdom has no layout, so a pointer-driven drag can
     *  never resolve a drop target there. Same escape hatch `DeckBuilder` and
     *  `PoolDeckBuilderForm` already carry. */
    manager?: DragDropManager;
}) {
    const { submitPick, selectDraftPick, setPoolArrangementEntry } =
        useLimitedEventMutations();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [menu, setMenu] = useState<LimitedPickContextMenuState | null>(null);
    // Booster zoom slider (ADR 0060, issue #1247, PRD #1107 story 21) —
    // mirrors the deckbuilder's per-zone `useCardZoom`/`CardZoomSlider`
    // wiring, its own "booster" zone so it persists independently of the
    // Pool surface's own zoom.
    const boosterZoom = useCardZoom({
        zone: "limited-booster",
        min: 1,
        max: 2.2,
        initial: 1.2,
    });

    const pack = seat.currentPack ?? [];
    const queueCount = seat.packQueueCount ?? 0;
    const pool = seat.pool ?? [];

    const handlePick = async (pickId: string) => {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await submitPick({ eventId, pickId });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong."
            );
        } finally {
            setPending(false);
        }
    };

    // Single-click SELECT (ADR 0060) — tentative only, never a commit. A
    // stale/raced selection is harmless (it just won't match anything once
    // the pack changes, see `LimitedEventSeat.selectedPickId`'s doc
    // comment), so failures are swallowed rather than surfaced as an error
    // banner.
    const handleSelect = (pickId: string) => {
        void selectDraftPick({ eventId, pickId }).catch(() => {});
    };

    // Commits the Pick AND immediately files the freshly-picked Pool card
    // where the gesture said — the Sideboard (context-menu "Pick to
    // sideboard", or a Booster→Sideboard drag) or the exact Column it was
    // dropped on (a Booster→Pool-Column drag). `pool` is append-only
    // (`applyPick`), so the new card's `poolIndex` is exactly the CURRENT
    // pool length, captured before the pick lands.
    //
    // Column ids are the shared engine's namespaced ones since issue #1632
    // (`mv:3`, `color:R`, `custom:ramp`), not the old `number | "lands"` pair
    // — the Pool renders through `DeckZoneSurface` now, so a drop can land on
    // a colour or type Column just as it can in the build view.
    const handlePickTo = async (
        pickId: string,
        sideboard: boolean,
        columnId: ColumnId | null
    ) => {
        if (pending) return;
        setPending(true);
        setError(null);
        const poolIndex = pool.length;
        try {
            await submitPick({ eventId, pickId });
            // A plain Pool drop that names no Column (and no Sideboard) is
            // just a Pick: the card already defaults into the Pool, so there
            // is nothing to record.
            if (sideboard || columnId !== null) {
                await setPoolArrangementEntry({
                    eventId,
                    ...poolArrangementPatch(poolIndex, sideboard, columnId),
                });
            }
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong."
            );
        } finally {
            setPending(false);
        }
    };

    const handlePickToSideboard = (pickId: string) =>
        handlePickTo(pickId, true, null);

    // Reorganises an ALREADY-picked Pool card (Pool ⇄ Sideboard, or between
    // Columns) — a Pool-card drag. The SAME `setPoolArrangementEntry` write
    // the build view's own column drag makes, on the same Pin model, which is
    // what makes a draft-time arrangement already in effect when the build
    // view opens (issue #1632).
    const handleMoveArrangement = (
        poolIndex: number,
        sideboard: boolean,
        columnId: ColumnId | null
    ) => {
        void setPoolArrangementEntry({
            eventId,
            ...poolArrangementPatch(poolIndex, sideboard, columnId),
        }).catch(() => {});
    };

    const handleDragEnd = (event: DragEndEvent) => {
        if (event.canceled) return;
        const data = event.operation?.source?.data as DraftDragData | undefined;
        const destId = event.operation?.target?.id as string | undefined;
        const action = resolveDraftDragAction(data, destId);
        if (!action) return;
        if (action.type === "commitPick") {
            void handlePickTo(action.pickId, action.sideboard, action.columnId);
        } else {
            handleMoveArrangement(
                action.poolIndex,
                action.sideboard,
                action.columnId
            );
        }
    };

    // The SAME sensor configuration the deckbuilder surfaces use, which since
    // issue #2583 reads its three thresholds from `~/lib/gesture/activation`.
    // This screen used to carry its own copy of the literals (250/10/8) — a
    // second opinion about activation that the gesture core exists to abolish.
    const sensors = useDeckDragSensors();

    // The Peek Panel (PRD #2405 D16, issue #2583) is the Draft Room's touch
    // read path, and it is wired HERE rather than left as an unused primitive
    // because this screen's tap already MEANS "select" (ADR 0060, issue
    // #1248) — the one editing surface whose existing gesture semantics are
    // exactly the gesture core's `tap -> select`. `holdPreview={false}` on the
    // pack card removed the long-press preview; this is what replaces it.
    const [peekClosedFor, setPeekClosedFor] = useState<string | null>(null);
    const [inspecting, setInspecting] = useState<string | null>(null);
    const selectedPickId = seat.selectedPickId ?? null;
    const peeked =
        selectedPickId && peekClosedFor !== selectedPickId
            ? (pack.find((c) => c.pickId === selectedPickId) ?? null)
            : null;
    const peekActions: readonly EditingSurfaceAction[] = peeked
        ? [
              {
                  label: "Pick",
                  primary: true,
                  disabled: pending,
                  onSelect: () => void handlePick(peeked.pickId),
              },
              {
                  label: "→ Side",
                  disabled: pending,
                  onSelect: () => void handlePickToSideboard(peeked.pickId),
              },
              {
                  label: "Inspect",
                  onSelect: () => setInspecting(peeked.cardId),
              },
          ]
        : [];

    return (
        <DragDropProvider
            manager={manager}
            sensors={sensors}
            onDragEnd={handleDragEnd}
        >
            {/* The Peek Panel is `fixed`, so the surface underneath has to
                reserve the room it occupies — a bottom sheet that COVERS the
                last row of the Pool is the occlusion the five-viewport probe
                exists to catch. */}
            <div
                className="mt-4 flex flex-col gap-3 border-t border-border-accent/20 pt-4"
                style={peeked ? { paddingBottom: "9rem" } : undefined}
            >
                <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>
                        Booster {round + 1} of {totalRounds}
                    </span>
                    <div className="flex items-center gap-2">
                        <CardZoomSlider
                            value={boosterZoom.value}
                            min={boosterZoom.min}
                            max={boosterZoom.max}
                            onChange={boosterZoom.set}
                            label="Booster card size"
                        />
                        <span>
                            {queueCount > 0
                                ? `${queueCount} pack${queueCount === 1 ? "" : "s"} queued`
                                : "No packs queued"}
                        </span>
                    </div>
                </div>

                {error && <Banner tone="danger">{error}</Banner>}

                {/* Full-width, mounted directly above the Booster grid (issue
                 *  #2238) — a 12px badge sharing the meta row's text-xs
                 *  muted tone with the zoom slider and queue count was not
                 *  findable under time pressure. `pack.length` is the SAME
                 *  cards-remaining count the server used to look up this
                 *  Pick's allowance (`assignFreshPack`), which is how the
                 *  bar derives its own denominator without a second
                 *  server-written field. */}
                <LimitedDraftTimer
                    pickDeadline={seat.pickDeadline}
                    cardsRemaining={pack.length}
                />

                <LimitedDraftPack
                    pack={pack}
                    selectedPickId={seat.selectedPickId ?? null}
                    onSelect={handleSelect}
                    onPick={(pickId) => void handlePick(pickId)}
                    onOpenMenu={(pickId, x, y) => setMenu({ pickId, x, y })}
                    pending={pending}
                    zoom={boosterZoom.value}
                />

                <div className="min-h-0 flex-1 border-t border-border-accent/20 pt-3">
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
                        Your Pool ({pool.length})
                    </h3>
                    <LimitedDraftPool
                        eventId={eventId}
                        pool={pool}
                        arrangement={seat.poolArrangement}
                    />
                </div>
            </div>

            <DragOverlay dropAnimation={null}>
                {(source) => {
                    const d = source.data as DraftDragData;
                    return (
                        <div
                            className="aspect-5/7"
                            style={{
                                width: `calc(${CARD_BASE} * 1.1)`,
                            }}
                        >
                            <CardImage
                                card={{ id: d.cardId }}
                                holdPreview={false}
                            />
                        </div>
                    );
                }}
            </DragOverlay>

            {peeked && (
                <PeekPanel
                    cardId={peeked.cardId}
                    name={peeked.cardName}
                    subtitle={`Booster ${round + 1} · ${pack.length} left`}
                    actions={peekActions}
                    onClose={() => setPeekClosedFor(peeked.pickId)}
                />
            )}

            {inspecting && (
                <InspectOverlay
                    cardId={inspecting}
                    actions={peekActions}
                    // PRD #2405 D15: in the Draft Room a tap anywhere closes,
                    // so read -> back to picking is one tap. "Pick" is exempt.
                    tapAnywhereCloses
                    onClose={() => setInspecting(null)}
                />
            )}

            {menu && (
                <LimitedPickContextMenu
                    state={menu}
                    onPick={(pickId) => void handlePick(pickId)}
                    onPickToSideboard={(pickId) =>
                        void handlePickToSideboard(pickId)
                    }
                    onClose={() => setMenu(null)}
                />
            )}
        </DragDropProvider>
    );
}
