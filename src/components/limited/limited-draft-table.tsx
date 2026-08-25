import { useMemo, useRef, useState } from "react";
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
import {
    usePeekPanelLayout,
    peekPanelReserve,
} from "~/components/editing/usePeekPanelLayout";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import DeckZonePeek from "~/components/deckbuilder/deck-zone-peek";
import type { DeckZoneSelection } from "~/components/deckbuilder/deckZoneSelection";
import { cardBase } from "~/lib/cardSizing";
import { useDraftKeyboardPicks } from "~/hooks/useDraftKeyboardPicks";
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
import { splitPoolByArrangement } from "@convex/limited/poolArrangement";
import DraftLandscapePanes from "./draft-room/draft-landscape-panes";
import DraftPackDensityToggle from "./draft-room/draft-pack-density-toggle";
import DraftPortraitPanes from "./draft-room/draft-portrait-panes";
import {
    draftPackColumns,
    nextDraftPackDensity,
    type DraftPackDensity,
} from "./draft-room/draftPackGrid";
import {
    draftPackIdentity,
    type DraftPhoneOrientation,
} from "./draft-room/draftSnapStops";
import type { DraftPhonePanesProps } from "./draft-room/draftPhonePanes";
import { useDraftPackRecall } from "./draft-room/useDraftPackRecall";
import { useDraftSnapStops } from "./draft-room/useDraftSnapStops";

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
 *  - Pool ⇄ Sideboard / between Columns: drag, OR a tap that SELECTS the
 *    card (issue #2667) — see `poolSelection` below.
 *
 *  ONE selection model, exclusive (issue #2667): the Booster's own
 *  `selectedPickId` (server-truth, ADR 0060) and this component's own
 *  `poolSelection` (a Pool/Sideboard tile) can never both be live. Selecting
 *  either clears the other, and exactly one Peek Panel is ever mounted below
 *  — the Booster's own `<PeekPanel>` (desktop/tablet; the phone regimes
 *  inline its CTAs into the strip instead, unchanged) or the Pool's
 *  `<DeckZonePeek>`, reused byte-for-byte from the deckbuilder (the SAME
 *  component `deck-zones-surface.tsx` mounts for its own Maindeck/Sideboard
 *  pair) rather than a second copy of its CTA-appending logic. Unlike the
 *  Booster's, the Pool's panel is NOT phone-special-cased: issue #2667's own
 *  AC asks for the real fixed Peek Panel at 390x844 and 844x390 too, and
 *  `DeckZonePeek` already behaves that way for the deckbuilder — reusing it
 *  gets that behaviour for free rather than inventing a third arrangement. */
export default function LimitedDraftTable({
    eventId,
    seat,
    round,
    manager,
    layout = "stacked",
    showPool = true,
}: {
    eventId: Id<"limitedEvents">;
    seat: LimitedEventSeatView;
    /** 0-based booster round — the Peek Panel's subtitle names it. The
     *  n-of-N counters live in the Draft Room's thin bar (issue #2587), which
     *  is why this component no longer takes a `totalRounds`. */
    round: number;
    /** dnd-kit manager, forwarded to this screen's own `DragDropProvider`.
     *  Omitted in the app (the provider makes its own); the mounted drag tests
     *  inject one so they can drive REAL drag operations against the REAL
     *  droppable registry — jsdom has no layout, so a pointer-driven drag can
     *  never resolve a drop target there. Same escape hatch `DeckBuilder` and
     *  `PoolDeckBuilderForm` already carry. */
    manager?: DragDropManager;
    /** Which arrangement of the Booster and the Pool to draw (ADR 0101 §6).
     *
     *  - `"split"` — tablet / desktop: side by side, the Peek Panel supplying
     *    the preview rail.
     *  - `"phone-portrait"` / `"phone-landscape"` — the two-stop snap surface
     *    (issue #2588). These are the fork this component exists to keep
     *    HONEST: they change the panes only. The `DragDropProvider`, the
     *    `DragOverlay`, the Inspect Overlay and the pick context menu are
     *    mounted ONCE, below, outside every branch — two providers or two
     *    overlays on different arms is a bug that passes every unit test.
     *  - `"stacked"` — one above the other. The pre-#2587 arrangement and the
     *    neutral default: no host selects it now (the room resolves one of
     *    the three above), and it is what this component renders when the
     *    caller expresses no preference, which is the configuration its own
     *    gesture tests use because those gestures are layout-independent. */
    layout?: "stacked" | "split" | "phone-portrait" | "phone-landscape";
    /** The Draft Room's pool toggle. The Pool pane is unmounted, not hidden:
     *  it renders every pooled card through `DeckZoneSurface`, and a
     *  `display:none` copy of that would keep paying for images the player
     *  asked to put away. */
    showPool?: boolean;
}) {
    const { submitPick, selectDraftPick, setPoolArrangementEntry } =
        useLimitedEventMutations();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [menu, setMenu] = useState<LimitedPickContextMenuState | null>(null);
    // Peek Panel / Inspect Overlay state (PRD #2405 D16, issue #2583) —
    // declared with the rest of the component's state because `handleSelect`
    // below clears the dismissal. What they mean is documented at the
    // derivation site further down.
    const [peekClosedFor, setPeekClosedFor] = useState<string | null>(null);
    const [inspecting, setInspecting] = useState<string | null>(null);
    // The Pool/Sideboard side of the ONE selection model (issue #2667) — a
    // full `DeckZoneSelection` rather than a bare card id, because
    // `DeckZonePeek` (reused unchanged from the deckbuilder) derives its
    // "Move to…" Column list and its selection ring straight off it.
    // `poolInspecting` mirrors `deck-zones-surface.tsx`'s own `inspecting`
    // state for the same reason: the overlay's CTA row is built from the
    // inspected CARD, not the currently selected one (they can differ for one
    // render while the overlay is up).
    const [poolSelection, setPoolSelection] =
        useState<DeckZoneSelection | null>(null);
    const [poolInspecting, setPoolInspecting] =
        useState<DeckZoneSelection | null>(null);
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

    // The PHONE fork (issue #2588). One derivation, read by everything below,
    // so "are we on a phone" is never asked twice with two different answers.
    const phoneOrientation: DraftPhoneOrientation | null =
        layout === "phone-portrait"
            ? "portrait"
            : layout === "phone-landscape"
              ? "landscape"
              : null;
    const [density, setDensity] = useState<DraftPackDensity>("fit");

    const pack = seat.currentPack ?? [];
    // Memoised on the seat's own array: `?? []` mints a fresh empty array on
    // every render, which would re-run the Pool split below every time.
    const pool = useMemo(() => seat.pool ?? [], [seat.pool]);

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
        // A fresh select SUPERSEDES an earlier dismissal (issue #2583
        // review): `peekClosedFor` is remembered per pick id, so without
        // this a card whose Peek Panel was closed once could never reopen it
        // — and since `holdPreview={false}` removed the long press from the
        // pack card, that card would have no touch read path left at all for
        // the rest of the draft.
        setPeekClosedFor(null);
        // Mutual exclusivity (issue #2667): a fresh Booster selection clears
        // whatever Pool/Sideboard selection was showing, LOCALLY — this side
        // owns no server field, so there is nothing to await or catch.
        setPoolSelection(null);
        setPoolInspecting(null);
        void selectDraftPick({ eventId, pickId }).catch(() => {});
    };

    // The Pool/Sideboard half of the selection (issue #2667) — a tap on a
    // Pool or Sideboard tile. Mirrors `handleSelect` the other way: it clears
    // the Booster's SERVER-side selection (`selectedPickId`) rather than only
    // a local flag, because that field is what a timer expiry auto-picks
    // (issue #1249) and a card the player is no longer looking at — they are
    // down in their Pool — must not be the one that gets auto-committed.
    // Best-effort, like every other selection write here: a raced clear is
    // harmless, it only means a stale highlight briefly lingers server-side.
    const handlePoolSelect = (selection: DeckZoneSelection) => {
        setPoolSelection(selection);
        if (seat.selectedPickId) {
            void selectDraftPick({ eventId, pickId: null }).catch(() => {});
        }
    };

    // The Pool's "Move to…" CTA (Peek Panel, issue #2667) and its Peek
    // Panel's own `onPin` — pins the card into a SPECIFIC Column, the exact
    // write a long-press drag onto that Column already made
    // (`handleMoveArrangement` below). `pinKey` is the Pool's own
    // `poolIndex`, stringified (`poolCopyPinKey`, `poolZoneCards.ts`) — the
    // SAME parse `resolveDraftDragAction` already does for a drag's payload,
    // so a click-placed Pin and a dragged one resolve through one function
    // from here on. Always `sideboard: false`: `onPin` is threaded to the
    // Pool's ("maindeck") `DeckZoneSurface` only (never the Sideboard's, which
    // has no Columns), so every card reaching this is already Pool-side.
    const handlePoolPin = (
        _cardId: string,
        columnId: ColumnId,
        pinKey: string
    ) => {
        const poolIndex = Number(pinKey);
        if (!Number.isInteger(poolIndex)) return;
        handleMoveArrangement(poolIndex, false, columnId);
    };

    // The Pool selection's zone-move CTA ("→ Side" / "→ Pool") — the SAME
    // `setPoolArrangementEntry` write a Pool ⇄ Sideboard DRAG already makes
    // (`handleMoveArrangement`), with no Column named so any existing Pin
    // survives the move untouched (`poolArrangementPatch` omits `column`
    // entirely when `columnId` is `null`).
    const handlePoolZoneMove = (pinKey: string, sideboard: boolean) => {
        const poolIndex = Number(pinKey);
        if (!Number.isInteger(poolIndex)) return;
        handleMoveArrangement(poolIndex, sideboard, null);
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
    //
    // `peekClosedFor` is a per-pick DISMISSAL, not a deselection: closing the
    // panel must leave the Selected Card selected (a timer expiry auto-picks
    // it, issue #1249) while hiding the panel. `handleSelect` clears it, so
    // re-tapping the card brings the panel back.
    const selectedPickId = seat.selectedPickId ?? null;
    /** The Selected Card itself (ADR 0060) — the seat's own selection, with
     *  no notion of a dismissal. The CTA SET hangs off this rather than off
     *  the panel below, because on a phone the CTAs are not IN the panel:
     *  they are inlined into the strip (issue #2588), where "close" is not a
     *  gesture that exists and a dismissal must not silently empty the row. */
    const selectedCard = selectedPickId
        ? (pack.find((c) => c.pickId === selectedPickId) ?? null)
        : null;
    /** What the Peek Panel shows: the selection MINUS a dismissal. */
    const peeked =
        selectedCard && peekClosedFor !== selectedCard.pickId
            ? selectedCard
            : null;
    const peekActions: readonly EditingSurfaceAction[] = selectedCard
        ? [
              {
                  label: "Pick",
                  primary: true,
                  disabled: pending,
                  onSelect: () => void handlePick(selectedCard.pickId),
              },
              {
                  label: "→ Side",
                  disabled: pending,
                  onSelect: () =>
                      void handlePickToSideboard(selectedCard.pickId),
              },
              {
                  label: "Inspect",
                  onSelect: () => setInspecting(selectedCard.cardId),
              },
          ]
        : [];

    // The Inspect Overlay's OWN CTA row is the Peek Panel's minus "Inspect"
    // (already inspecting — that CTA would set `inspecting` and then be
    // cancelled by the overlay's own dismiss, a silent no-op), and each
    // remaining CTA closes the overlay after firing. Without the close, a tap
    // on "Pick" commits the pick and leaves a full-screen card over the NEXT
    // pack with no CTA row (once the pick lands `peeked` is null, so
    // `peekActions` collapses to `[]`). Issue #2583 review.
    const inspectActions: readonly EditingSurfaceAction[] = peekActions
        .filter((action) => action.label !== "Inspect")
        .map((action) => ({
            ...action,
            onSelect: () => {
                action.onSelect();
                setInspecting(null);
            },
        }));

    // The Pool/Sideboard selection's own CTA row (issue #2667) — the zone
    // move, mirroring `deck-zones-surface.tsx`'s `actionsFor` (same shape,
    // same "primary CTA is the zone the card is NOT currently in" rule) so a
    // player who has used the build view's Peek Panel finds an identical row
    // here. `DeckZonePeek` appends "Move to…" (only offered when
    // `selection.columns` is non-empty — Pool selections only, since the
    // Sideboard's `DeckZoneSurface` gets no `onPin`) and "Inspect" itself.
    //
    // `setPoolSelection(null)` after firing (review finding #2797-1): without
    // it the panel stayed open holding a now-STALE selection whose zone no
    // longer matched reality, and `handlePoolPin`'s `sideboard: false` is
    // hard-coded on the assumption `onPin` is only ever reachable from a Pool
    // (not Sideboard) selection — an assumption a stale selection breaks. A
    // player who tapped "→ Side" and then "Move to… → Lands" on the still-open
    // panel got the card silently pulled back OUT of the Sideboard. Mirrors
    // `deck-zones-surface.tsx`'s `actionsFor`, which clears `selection` the
    // same way; the Inspect Overlay's own copy of this row closes via
    // `DeckZonePeek`'s `onCloseInspect` wrapper already, same as there.
    const poolActionsFor = (
        target: DeckZoneSelection
    ): readonly EditingSurfaceAction[] =>
        target.zone === "maindeck"
            ? [
                  {
                      label: "→ Side",
                      primary: true,
                      onSelect: () => {
                          handlePoolZoneMove(target.pinKey, true);
                          setPoolSelection(null);
                      },
                  },
              ]
            : [
                  {
                      label: "→ Pool",
                      primary: true,
                      onSelect: () => {
                          handlePoolZoneMove(target.pinKey, false);
                          setPoolSelection(null);
                      },
                  },
              ];
    const poolPeekActions = poolSelection ? poolActionsFor(poolSelection) : [];
    const poolInspectActions = poolInspecting
        ? poolActionsFor(poolInspecting)
        : [];

    // The panel is `fixed`, so the surface underneath reserves the room it
    // occupies — on the axis the RESOLVED layout actually eats. At four of
    // the five UI-gate viewports that is WIDTH (the rail), not height.
    const peekLayout = usePeekPanelLayout();

    // ...but NOT on a phone (issue #2588). There the CTA row is inlined into
    // the strip that is already on screen (`draft-selection-actions.tsx`),
    // because the Peek Panel's landscape arrangement is a 224px right rail
    // and the right edge of a landscape phone is exactly where the sneak-peek
    // column lives — two `fixed`-ish surfaces fighting for one edge, and a
    // reserve paid for a panel that is no longer the peek bar. Issue #2588
    // calls the strip "its status / Peek bar"; this is that.
    //
    // A DELIBERATE deviation from ADR 0101 §4 (portrait bottom sheet /
    // landscape right rail on every editing surface), not an oversight: §4
    // predates §6's sneak-peek column, which claims the same edge, and the
    // portrait sheet was the measured source of the `cardsOcc 3` debt at
    // 390x844 that this change deletes from `budgets.json`. §4's actual
    // requirement — the 44px CTA row as the primary touch move path — still
    // holds; only its host moves.
    //
    // `!poolSelection` (issue #2667) is a defensive second gate, not the
    // primary one: `handlePoolSelect` already clears `selectedPickId`
    // server-side, so `peeked` normally goes null on its own the next time
    // `seat` updates. This is what keeps the two panels from BOTH painting
    // for the one render in between — the local selection lands
    // synchronously, the server clear does not.
    const peekPanel =
        phoneOrientation === null && !poolSelection ? peeked : null;

    // The two-stop snap scroller and the pack-arrival recall (ADR 0101 §6).
    // Called unconditionally — hooks cannot live behind the layout fork — and
    // inert off a phone: nothing reads `stop`, and the recall's interval only
    // ever starts while the player is parked on the pool.
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const snap = useDraftSnapStops(scrollerRef, phoneOrientation ?? "portrait");
    const { pulsing } = useDraftPackRecall({
        packIdentity: draftPackIdentity(pack),
        stop: snap.stop,
        pickDeadline: seat.pickDeadline,
        onRecall: () => snap.snapTo("pack"),
    });

    // Arrows / Enter / S (ADR 0101 §6). Wired to the SAME three handlers the
    // click, the context menu, the Peek Panel CTA row and the drag use — see
    // `useDraftKeyboardPicks` for why that is the whole point of the hook.
    useDraftKeyboardPicks({
        enabled: !pending,
        pack,
        selectedPickId,
        onSelect: handleSelect,
        onPick: (pickId) => void handlePick(pickId),
        onPickToSideboard: (pickId) => void handlePickToSideboard(pickId),
    });

    /* Full-width, mounted directly above the Booster grid (issue #2238) — a
     * 12px badge sharing a meta row's text-xs muted tone was not findable
     * under time pressure, which is also why the Draft Room's thin bar
     * deliberately carries no second copy of the countdown. `pack.length` is
     * the SAME cards-remaining count the server used to look up this Pick's
     * allowance (`assignFreshPack`), which is how the bar derives its own
     * denominator without a second server-written field.
     *
     * ONE element, handed to whichever arrangement is drawn — the phone panes
     * mount it in the band that survives BOTH snap stops, which is what "a
     * pack arriving while parked on the pool starts the timer" (ADR 0101 §6)
     * amounts to once the countdown is server-stamped. */
    const timer = (
        <LimitedDraftTimer
            pickDeadline={seat.pickDeadline}
            cardsRemaining={pack.length}
        />
    );

    const packGrid = (
        <LimitedDraftPack
            pack={pack}
            selectedPickId={seat.selectedPickId ?? null}
            onSelect={handleSelect}
            onPick={(pickId) => void handlePick(pickId)}
            onOpenMenu={(pickId, x, y) => setMenu({ pickId, x, y })}
            pending={pending}
            zoom={phoneOrientation === null ? boosterZoom.value : undefined}
            columns={
                phoneOrientation === null
                    ? undefined
                    : draftPackColumns(phoneOrientation, density)
            }
        />
    );

    const packPane = (
        <>
            {timer}
            {packGrid}
        </>
    );

    const poolPane = (
        <>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-text-muted uppercase">
                Your Pool ({pool.length})
            </h3>
            <LimitedDraftPool
                eventId={eventId}
                pool={pool}
                arrangement={seat.poolArrangement}
                selection={poolSelection}
                onCardSelect={handlePoolSelect}
                onPin={handlePoolPin}
            />
        </>
    );

    // The Pool split by the seat's own Arrangement — the SAME pure function
    // `LimitedDraftPool` renders from, so the strip's counts and the pane's
    // contents can never disagree. Only the phone strips read it.
    const poolSplit = useMemo(
        () => splitPoolByArrangement(pool, seat.poolArrangement ?? undefined),
        [pool, seat.poolArrangement]
    );
    const phonePanes: DraftPhonePanesProps = {
        scrollerRef,
        snap,
        packGrid,
        timer,
        pool: (
            <LimitedDraftPool
                eventId={eventId}
                pool={pool}
                arrangement={seat.poolArrangement}
                arrange={phoneOrientation === "portrait" ? "column" : "row"}
                selection={poolSelection}
                onCardSelect={handlePoolSelect}
                onPin={handlePoolPin}
            />
        ),
        densityToggle: (
            <DraftPackDensityToggle
                orientation={phoneOrientation ?? "portrait"}
                density={density}
                packSize={pack.length}
                onToggle={() => setDensity(nextDraftPackDensity)}
            />
        ),
        packPile: pack.map((card) => ({
            key: card.pickId,
            cardId: card.cardId,
        })),
        pickPile: [
            ...poolSplit.cards.map((card) => ({
                key: `pool-${card.poolIndex}`,
                cardId: card.cardId,
            })),
            ...poolSplit.sideboard.map((card) => ({
                key: `pool-${card.poolIndex}`,
                cardId: card.cardId,
                highlight: true,
            })),
        ],
        mainCount: poolSplit.cards.length,
        sideCount: poolSplit.sideboard.length,
        // The same n the room's thin bar shows: the pool is append-only, so
        // the number of picks made is its length.
        pickNumber: pool.length + 1,
        packLeft: pack.length,
        // `!poolSelection` (review finding #2797-5): the SAME defensive gate
        // `peekPanel` already carries above. Without it, on a phone the
        // pack's inline CTA row — including the destructive "Pick" — kept
        // rendering beside an OPEN Pool/Sideboard panel until
        // `selectDraftPick({pickId:null})` round-tripped, and indefinitely if
        // that write rejected (`handlePoolSelect` swallows the rejection,
        // matching every other best-effort selection write on this screen —
        // `handleSelect`'s own `.catch(() => {})` above is the same
        // contract). Gating locally is what keeps the strip honest in the
        // interim regardless of whether the server write ever lands.
        selected:
            selectedCard && !poolSelection
                ? {
                      cardId: selectedCard.cardId,
                      cardName: selectedCard.cardName,
                  }
                : null,
        actions: peekActions,
        pulsing,
    };

    return (
        <DragDropProvider
            manager={manager}
            sensors={sensors}
            onDragEnd={handleDragEnd}
        >
            {/* The Peek Panel is `fixed`, so the surface underneath has to
                reserve the room it occupies — a bottom sheet that COVERS the
                last row of the Pool, or a right rail that covers the right
                224px of the Booster grid, is the occlusion the five-viewport
                probe exists to catch. */}
            {/* No top border / `mt-4` any more: that was this block's
                separator from the event chrome it used to sit under (issue
                #2515's 16px accounting). The Draft Room is its own route now
                and there is nothing above the Booster to separate from. */}
            <div
                data-slot="draft-surface"
                data-layout={layout}
                className="flex min-h-0 flex-1 flex-col gap-3"
                // Issue #2667: the Pool's `DeckZonePeek` is ALSO `fixed` and
                // reserves on the same axis, unlike the Booster's — it opens
                // at every viewport, phone included (`peekPanel` above is
                // `null` there by design). Either truthy reserves; the two
                // are mutually exclusive so this never double-reserves.
                style={
                    peekPanel || poolSelection
                        ? peekPanelReserve(peekLayout)
                        : undefined
                }
            >
                {/* The zoom SLIDER is a desktop control: a phone gets the
                    two-rung density toggle instead, mounted inside the pane
                    that owns the grid (issue #2588). A drag-to-scrub control
                    on a surface where every drag moves a card is the wrong
                    affordance, and this row is 40px the 85% pane cannot
                    spare. */}
                {phoneOrientation === null && (
                    <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
                        <CardZoomSlider
                            value={boosterZoom.value}
                            min={boosterZoom.min}
                            max={boosterZoom.max}
                            onChange={boosterZoom.set}
                            label="Booster card size"
                        />
                    </div>
                )}

                {error && <Banner tone="danger">{error}</Banner>}

                {!showPool && phoneOrientation !== null ? (
                    // The bar's pool toggle is OFF: there is no second pane,
                    // so there is nothing to snap between. The Booster takes
                    // the whole surface at the phone's own grid density.
                    <>
                        {timer}
                        {packGrid}
                    </>
                ) : phoneOrientation === "portrait" ? (
                    <DraftPortraitPanes {...phonePanes} />
                ) : phoneOrientation === "landscape" ? (
                    <DraftLandscapePanes {...phonePanes} />
                ) : layout === "split" ? (
                    // Tablet / desktop (ADR 0101 §6): a vertical split, pack
                    // beside pool. Each half scrolls on its own so a long
                    // Pool never pushes the Booster off the screen — the
                    // exact failure the stacked layout has on a short
                    // viewport. The preview RAIL is the Peek Panel: it is
                    // `fixed`, and the reserve above already pays for its
                    // width, so the split is measured against what is left.
                    <div
                        data-slot="draft-split"
                        className="flex min-h-0 flex-1 gap-3"
                    >
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
                            {packPane}
                        </div>
                        {showPool && (
                            <div className="flex min-h-0 w-[36%] shrink-0 flex-col overflow-y-auto border-l border-border-accent/20 pl-3">
                                {poolPane}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {packPane}
                        {showPool && (
                            <div className="min-h-0 flex-1 border-t border-border-accent/20 pt-3">
                                {poolPane}
                            </div>
                        )}
                    </>
                )}
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

            {peekPanel && (
                <PeekPanel
                    cardId={peekPanel.cardId}
                    name={peekPanel.cardName}
                    subtitle={`Booster ${round + 1} · ${pack.length} left`}
                    actions={peekActions}
                    onClose={() => setPeekClosedFor(peekPanel.pickId)}
                />
            )}

            {inspecting && (
                <InspectOverlay
                    cardId={inspecting}
                    actions={inspectActions}
                    // PRD #2405 D15: in the Draft Room a tap anywhere closes,
                    // so read -> back to picking is one tap. "Pick" is exempt.
                    tapAnywhereCloses
                    onClose={() => setInspecting(null)}
                />
            )}

            {/* The Pool/Sideboard half of the ONE selection model (issue
                #2667) — reused byte-for-byte from the deckbuilder rather than
                a second copy of its CTA-appending ("Move to…"/"Inspect")
                logic. Mounted unconditionally: `DeckZonePeek` itself renders
                nothing while `poolSelection` is `null` (its own internal
                `{selection && (...)}` guards), so this never doubles up with
                the Booster's `<PeekPanel>` above — the two selections are
                kept exclusive at the STATE level (`handleSelect` /
                `handlePoolSelect`), not by a render-time branch here. */}
            <DeckZonePeek
                selection={poolSelection}
                subtitle={
                    poolSelection?.zone === "maindeck" ? "Pool" : "Sideboard"
                }
                onClose={() => setPoolSelection(null)}
                actions={poolPeekActions}
                onPin={handlePoolPin}
                inspecting={poolInspecting}
                inspectActions={poolInspectActions}
                onInspect={setPoolInspecting}
                onCloseInspect={() => setPoolInspecting(null)}
                // Same PRD #2405 D15 rule the Booster's own Inspect Overlay
                // above already applies — one Draft Room, one dismissal
                // convention for both halves of the selection it now shares
                // this panel between.
                inspectTapAnywhereCloses
            />

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
