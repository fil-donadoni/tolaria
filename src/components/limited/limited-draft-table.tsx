import { useMemo, useState } from "react";
import {
    DragDropProvider,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    type DragEndEvent,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import type { Id } from "@convex/_generated/dataModel";
import {
    useLimitedEventMutations,
    type LimitedEventSeatView,
} from "~/hooks/useLimitedEvent";
import CardImage from "~/components/cards/card-image";
import { Banner } from "@/components/ui/banner";
import CardZoomSlider from "~/components/lobby/deck-builder/card-zoom-slider";
import { useCardZoom } from "~/components/lobby/deck-builder/useCardZoom";
import { cardBase } from "~/lib/cardSizing";
import LimitedDraftPack from "./limited-draft-pack";
import LimitedDraftTimer from "./limited-draft-timer";
import LimitedDraftPool from "./limited-draft-pool";
import LimitedPickContextMenu, {
    type LimitedPickContextMenuState,
} from "./limited-pick-context-menu";
import {
    resolveDraftDragAction,
    type DraftDragData,
    type DraftDropTarget,
} from "./limitedDraftDrag";

// Same responsive base size as the shared pool deckbuilder surface / draft
// pack (`CARD_BASE` in `pool-deckbuilder-surface.tsx` / `limited-draft-pack.tsx`),
// floored at CARD_MIN_W (issue #2056) so a short-and-wide viewport can't
// collapse the drag-overlay tile past legibility.
const CARD_BASE = cardBase("7.5rem", "17vw", "9dvh");

/** The Draft table (PRD #1107 stories 10-13, issue #1112; pick gestures +
 *  Selected Card per ADR 0060, issue #1248): the Booster in front of the
 *  viewer and the viewer's accumulated Pool so far, sharing ONE
 *  `DragDropProvider` so a Booster card can be dragged straight into a Pool
 *  column or the Sideboard (`LimitedDraftPool`'s columns register their own
 *  `useDroppable` targets as descendants of this provider — see
 *  `limitedDraftDrag.ts`'s module doc comment).
 *
 *  Gestures:
 *  - single click on a Booster card → SELECTS it (`selectDraftPick`),
 *    never commits.
 *  - double click / the context-menu "Pick" / a drag onto a Pool column →
 *    commits the Pick into its Mana-Value column (or the dropped-on column,
 *    for a drag onto a SPECIFIC one).
 *  - the context-menu "Pick to sideboard" / a drag onto the Sideboard →
 *    commits the Pick AND parks the new Pool card in the Sideboard, in one
 *    user gesture.
 *  - Pool ⇄ Sideboard / between Mana-Value columns: drag OR double-click
 *    (`LimitedDraftPool`'s own tiles), persisted via `setPoolArrangementEntry`. */
export default function LimitedDraftTable({
    eventId,
    seat,
    round,
    totalRounds,
}: {
    eventId: Id<"limitedEvents">;
    seat: LimitedEventSeatView;
    round: number;
    totalRounds: number;
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

    // Commits the Pick AND immediately parks the freshly-picked Pool card
    // in the Sideboard — the context-menu "Pick to sideboard" action and a
    // Booster→Sideboard drag both resolve here. `pool` is append-only
    // (`applyPick`), so the new card's `poolIndex` is exactly the CURRENT
    // pool length, captured before the pick lands.
    const handlePickToSideboard = async (pickId: string) => {
        if (pending) return;
        setPending(true);
        setError(null);
        const poolIndex = pool.length;
        try {
            await submitPick({ eventId, pickId });
            await setPoolArrangementEntry({
                eventId,
                poolIndex,
                sideboard: true,
            });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong."
            );
        } finally {
            setPending(false);
        }
    };

    // Commits the Pick and overrides its column to exactly the one it was
    // dropped on — a Booster→Pool-column drag (a numbered Mana-Value
    // column, or "lands" — issue #1573).
    const handlePickToColumn = async (
        pickId: string,
        column: number | "lands"
    ) => {
        if (pending) return;
        setPending(true);
        setError(null);
        const poolIndex = pool.length;
        try {
            await submitPick({ eventId, pickId });
            await setPoolArrangementEntry({ eventId, poolIndex, column });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong."
            );
        } finally {
            setPending(false);
        }
    };

    // Reorganises an ALREADY-picked Pool card (Pool ⇄ Sideboard, or between
    // Mana-Value columns) — a Pool-card drag.
    const handleMoveArrangement = (
        poolIndex: number,
        target: DraftDropTarget
    ) => {
        void setPoolArrangementEntry({
            eventId,
            poolIndex,
            sideboard: target.kind === "sideboard",
            ...(target.kind === "column" ? { column: target.column } : {}),
        }).catch(() => {});
    };

    const handleDragEnd = (event: DragEndEvent) => {
        if (event.canceled) return;
        const data = event.operation?.source?.data as DraftDragData | undefined;
        const destId = event.operation?.target?.id as string | undefined;
        const action = resolveDraftDragAction(data, destId);
        if (!action) return;
        if (action.type === "commitPick") {
            if (action.target.kind === "sideboard") {
                void handlePickToSideboard(action.pickId);
            } else {
                void handlePickToColumn(action.pickId, action.target.column);
            }
        } else {
            handleMoveArrangement(action.poolIndex, action.target);
        }
    };

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

    return (
        <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="mt-4 flex flex-col gap-3 border-t border-border-accent/20 pt-4">
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
                        <LimitedDraftTimer pickDeadline={seat.pickDeadline} />
                        <span>
                            {queueCount > 0
                                ? `${queueCount} pack${queueCount === 1 ? "" : "s"} queued`
                                : "No packs queued"}
                        </span>
                    </div>
                </div>

                {error && <Banner tone="danger">{error}</Banner>}

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
                            <CardImage card={{ id: d.cardId }} />
                        </div>
                    );
                }}
            </DragOverlay>

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
