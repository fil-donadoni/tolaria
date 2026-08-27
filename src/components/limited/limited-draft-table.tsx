import { useEffect, useMemo, useRef, useState } from "react";
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
import InspectOverlay from "~/components/editing/inspect-overlay";
import {
    usePeekPanelLayout,
    peekPanelReserve,
} from "~/components/editing/usePeekPanelLayout";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import DeckZonePeek from "~/components/deckbuilder/deck-zone-peek";
import ActionSheet from "~/components/ui/action-sheet";
import type { DeckZoneSelection } from "~/components/deckbuilder/deckZoneSelection";
import { cardBase } from "~/lib/cardSizing";
import { useDraftKeyboardPicks } from "~/hooks/useDraftKeyboardPicks";
import LimitedDraftPack from "./limited-draft-pack";
import LimitedDraftTimer from "./limited-draft-timer";
import LimitedDraftPool from "./limited-draft-pool";
import LimitedPickContextMenu, {
    type LimitedDraftMenuState,
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
     *  - `"stacked"` — tablet / desktop: the Booster grid full width above
     *    the Pool (with its Sideboard rail beside it), each in its own
     *    scrolling band so a long Pool never pushes the Booster off screen.
     *    The pre-#2587 arrangement, restored by issue #2820 after #2588
     *    accidentally widened the phone split to cover this arm too — and
     *    the neutral default: it is what this component renders when the
     *    caller expresses no preference, which is the configuration its own
     *    gesture tests use because those gestures are layout-independent.
     *  - `"phone-portrait"` / `"phone-landscape"` — the two-stop snap surface
     *    (issue #2588). These are the fork this component exists to keep
     *    HONEST: they change the panes only. The `DragDropProvider`, the
     *    `DragOverlay`, the Inspect Overlay and the pick context menu are
     *    mounted ONCE, below, outside every branch — two providers or two
     *    overlays on different arms is a bug that passes every unit test.
     *
     *  There is no `"split"` value any more (issue #2820): a fourth layout
     *  nothing resolved to was unreachable code the moment the Draft Room's
     *  own resolution stopped selecting it. */
    layout?: "stacked" | "phone-portrait" | "phone-landscape";
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
    // The Draft Room's ONE card context menu (issue #2861) — Booster, Pool
    // and Sideboard alike, whichever surface opened it last. The menu owns no
    // action vocabulary of its own: every entry is an `EditingSurfaceAction`
    // the opener built, the same descriptors the Inspect Overlay is built
    // from, so a label or behavior can never diverge between the doors.
    const [menu, setMenu] = useState<LimitedDraftMenuState | null>(null);
    // The Inspect Overlay (PRD #2405, issue #2583; generalised by issue
    // #2861 to open from ANY of the three surfaces — a Booster/Pool/Sideboard
    // menu's "Inspect" item, a desktop right-click, or the phone strip's own
    // CTA row) — carries its OWN action row rather than deriving one
    // reactively from whatever is currently selected, because a desktop
    // right-click can inspect a DIFFERENT card than the Selected one.
    const [inspecting, setInspecting] = useState<{
        cardId: string;
        actions: readonly EditingSurfaceAction[];
    } | null>(null);
    // The desktop Pool/Sideboard menu's own "Move to…" sheet (issue #2861) —
    // `moveSheetSelection` stays set through the close animation (mirrors
    // `ActionSheet`'s own `open` contract elsewhere, e.g. `DeckZonePeek`'s
    // `pickingColumn`), `moveSheetOpen` is what actually toggles it.
    const [moveSheetSelection, setMoveSheetSelection] =
        useState<DeckZoneSelection | null>(null);
    const [moveSheetOpen, setMoveSheetOpen] = useState(false);
    // The desktop Pool/Sideboard menu opens at the CLICK POINT, but
    // `DeckCardTile`'s own `onClick` prop carries no event (issue #2861) — it
    // is a plain `() => void`, shared with the BUILD view's immediate-move
    // click, which never needed one. Captured on a CAPTURE-phase listener on
    // the desktop Pool pane's own wrapper (below), which always runs before
    // the tile's own bubble-phase click handler reads it.
    const desktopPoolClickPos = useRef({ x: 0, y: 0 });
    // The desktop Pool/Sideboard menu's own open delay (issue #2861: "the
    // menu on a Pool or Sideboard tile opens on a short delay — the double
    // click window — so a second click performs the move and the menu never
    // appears"). Cancelled on a second click (the move fires instead) and on
    // unmount, below.
    const poolMenuOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    useEffect(
        () => () => {
            if (poolMenuOpenTimer.current !== null)
                clearTimeout(poolMenuOpenTimer.current);
        },
        []
    );
    // The Pool/Sideboard half of the PHONE selection model (issue #2667) — a
    // full `DeckZoneSelection` rather than a bare card id, because
    // `DeckZonePeek` (reused unchanged from the deckbuilder) derives its
    // "Move to…" Column list and its selection ring straight off it.
    // `poolInspecting` mirrors `deck-zones-surface.tsx`'s own `inspecting`
    // state for the same reason: the overlay's CTA row is built from the
    // inspected CARD, not the currently selected one (they can differ for one
    // render while the overlay is up). Desktop no longer reaches either state
    // (issue #2861: no Peek rail there) — only the phone panes' own
    // `<LimitedDraftPool>` still wires `onCardSelect` to `handlePoolSelect`
    // below.
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
    // from here on.
    //
    // `undefined`, never a Zone value (PR #2797 review round 2 / issue #2667
    // round 3): a column PIN reads no Zone, so it must not ASSERT one either —
    // `handleMoveArrangement`/`poolArrangementPatch` treat `undefined` as
    // "leave the Zone untouched", the same contract the mutation's own
    // `sideboard` arg already speaks. This used to hard-code `sideboard:
    // false` on the assumption `onPin` is only ever reachable from a Pool
    // (not Sideboard) selection — true when the tap that OPENED the panel
    // fired, but not necessarily true by the time this CTA is tapped: a DRAG
    // can move the same card to the Sideboard while the panel sits open and
    // never hears about it (`poolSelection` is local React state, not
    // recomputed off the live Arrangement), so the "already Pool-side"
    // assumption could go stale mid-panel. Passing `undefined` here makes
    // the write correct regardless of whether the assumption still holds —
    // no caller of a pure column pin can corrupt a Zone it never read.
    const handlePoolPin = (
        _cardId: string,
        columnId: ColumnId,
        pinKey: string
    ) => {
        const poolIndex = Number(pinKey);
        if (!Number.isInteger(poolIndex)) return;
        handleMoveArrangement(poolIndex, undefined, columnId);
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
        // `undefined` = don't touch the Zone (a pure column pin — see
        // `handlePoolPin`'s doc comment); every other caller here passes a
        // real, freshly-computed boolean off an actual drop/CTA target.
        sideboard: boolean | undefined,
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

    // The Selected Card's own Inspect Overlay actions (issue #2583, folded by
    // #2861 into a helper reusable from the Booster's desktop menu too):
    // "Pick" / "→ Side", each closing the overlay after firing — without the
    // close, a tap on "Pick" commits the pick and leaves a full-screen card
    // over the NEXT pack.
    const boosterInspectActionsFor = (
        card: (typeof pack)[number]
    ): EditingSurfaceAction[] => [
        {
            label: "Pick",
            primary: true,
            disabled: pending,
            onSelect: () => {
                void handlePick(card.pickId);
                setInspecting(null);
            },
        },
        {
            label: "→ Side",
            disabled: pending,
            onSelect: () => {
                void handlePickToSideboard(card.pickId);
                setInspecting(null);
            },
        },
    ];

    // The desktop Booster menu's own action set (issue #2861) — "Pick" / "→
    // Side" / "Inspect", the SAME three the phone strip's CTA row offers
    // (`peekActions` below), just opened by a click on the card instead of by
    // the Selected Card's own row.
    const boosterMenuActionsFor = (
        card: (typeof pack)[number]
    ): EditingSurfaceAction[] => [
        {
            label: "Pick",
            primary: true,
            disabled: pending,
            onSelect: () => void handlePick(card.pickId),
        },
        {
            label: "→ Side",
            disabled: pending,
            onSelect: () => void handlePickToSideboard(card.pickId),
        },
        {
            label: "Inspect",
            onSelect: () =>
                setInspecting({
                    cardId: card.cardId,
                    actions: boosterInspectActionsFor(card),
                }),
        },
    ];

    // Left click on a Booster card, desktop regime (issue #2861): opens the
    // menu right there, no delay — there is no double-click gesture left on
    // this regime to arbitrate against (see `LimitedDraftPackCard`'s own doc
    // comment for why the delay the Pool/Sideboard menu needs does not apply
    // here).
    const openBoosterMenu = (pickId: string, x: number, y: number) => {
        const card = pack.find((c) => c.pickId === pickId);
        if (!card) return;
        setMenu({
            x,
            y,
            // The round number the Peek Panel's own subtitle used to carry
            // (`Booster ${round + 1} · ${pack.length} left`) — retired along
            // with the panel (issue #2861), folded into the menu's own
            // `aria-label` instead so it isn't lost entirely.
            label: `Booster ${round + 1} pick actions`,
            actions: boosterMenuActionsFor(card),
        });
    };

    // Real right-click on a Booster card, desktop regime (issue #2861): opens
    // the Inspect Overlay directly, no menu — what a right-click already
    // means everywhere else in the app.
    const openBoosterInspect = (pickId: string) => {
        const card = pack.find((c) => c.pickId === pickId);
        if (!card) return;
        setInspecting({
            cardId: card.cardId,
            actions: boosterInspectActionsFor(card),
        });
    };

    // Real right-click on a Booster card, PHONE regime (unchanged, ADR 0060):
    // the original "Pick" / "Pick to sideboard" menu.
    const openBoosterContextMenu = (pickId: string, x: number, y: number) => {
        setMenu({
            x,
            y,
            label: "Draft pick actions",
            actions: [
                { label: "Pick", onSelect: () => void handlePick(pickId) },
                {
                    label: "Pick to sideboard",
                    onSelect: () => void handlePickToSideboard(pickId),
                },
            ],
        });
    };

    // The Draft Room's touch read path (PRD #2405 D16, issue #2583) is wired
    // HERE rather than left as an unused primitive because this screen's tap
    // already MEANS "select" (ADR 0060, issue #1248) — the one editing
    // surface whose existing gesture semantics are exactly the gesture
    // core's `tap -> select`. `holdPreview={false}` on the pack card removed
    // the long-press preview; this is what replaces it.
    const selectedPickId = seat.selectedPickId ?? null;
    /** The Selected Card itself (ADR 0060) — the seat's own selection. The
     *  CTA SET hangs off this rather than off a panel, because on a phone
     *  the CTAs are not in a panel: they are inlined into the strip (issue
     *  #2588). Desktop no longer reads this for a panel either (issue #2861:
     *  no Peek rail there) — only the phone strip's own row still does. */
    const selectedCard = selectedPickId
        ? (pack.find((c) => c.pickId === selectedPickId) ?? null)
        : null;
    /** The phone strip's own CTA row (issue #2588) — unchanged by issue
     *  #2861, which only retires the DESKTOP arm of this same selection. */
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
                  onSelect: () =>
                      setInspecting({
                          cardId: selectedCard.cardId,
                          actions: boosterInspectActionsFor(selectedCard),
                      }),
              },
          ]
        : [];

    // The Pool/Sideboard PHONE selection's own CTA row (issue #2667) — the zone
    // move, mirroring `deck-zones-surface.tsx`'s `actionsFor` (same shape,
    // same "primary CTA is the zone the card is NOT currently in" rule) so a
    // player who has used the build view's Peek Panel finds an identical row
    // here. `DeckZonePeek` appends "Move to…" (only offered when
    // `selection.columns` is non-empty — Pool selections only, since the
    // Sideboard's `DeckZoneSurface` gets no `onPin`) and "Inspect" itself.
    //
    // `setPoolSelection(null)` after firing (review finding #2797-1): without
    // it the panel stayed open holding a now-STALE selection whose zone no
    // longer matched reality. Kept as a UX improvement — closing the panel
    // after its own zone-move CTA fires, exactly like
    // `deck-zones-surface.tsx`'s `actionsFor` does — but it is NOT what keeps
    // a stale selection from corrupting the Arrangement any more: this CTA is
    // only one of several doors onto a stale `poolSelection` (a Pool ⇄
    // Sideboard DRAG opens the same one, and it does not fire through here at
    // all — issue #2667 round 3, PR #2797 review round 2). The actual fix is
    // at the write itself: `handlePoolPin`/`poolArrangementPatch` no longer
    // let a column pin assert a Zone value in the first place, so a stale
    // selection — however it went stale — can no longer overwrite one. The
    // Inspect Overlay's own copy of this row closes via `DeckZonePeek`'s
    // `onCloseInspect` wrapper already, same as `deck-zones-surface.tsx`.
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

    // The DESKTOP Pool/Sideboard menu (issue #2861) — the zone-move CTA, an
    // optional "Move to…" (a Column pin, offered only when the selection
    // carries destinations — Pool selections only, mirroring `poolActionsFor`
    // above) opening the SAME `ActionSheet` the phone/build-view Peek Panels
    // already use for it, and "Inspect".
    const desktopPoolInspectActionsFor = (
        selection: DeckZoneSelection
    ): EditingSurfaceAction[] => [
        selection.zone === "maindeck"
            ? {
                  label: "→ Side",
                  primary: true,
                  onSelect: () => {
                      handlePoolZoneMove(selection.pinKey, true);
                      setInspecting(null);
                  },
              }
            : {
                  label: "→ Pool",
                  primary: true,
                  onSelect: () => {
                      handlePoolZoneMove(selection.pinKey, false);
                      setInspecting(null);
                  },
              },
    ];
    const desktopPoolMenuActionsFor = (
        selection: DeckZoneSelection
    ): EditingSurfaceAction[] => [
        selection.zone === "maindeck"
            ? {
                  label: "→ Side",
                  primary: true,
                  onSelect: () => handlePoolZoneMove(selection.pinKey, true),
              }
            : {
                  label: "→ Pool",
                  primary: true,
                  onSelect: () => handlePoolZoneMove(selection.pinKey, false),
              },
        ...(selection.columns.length > 0
            ? [
                  {
                      label: "Move to…",
                      onSelect: () => {
                          setMoveSheetSelection(selection);
                          setMoveSheetOpen(true);
                      },
                  },
              ]
            : []),
        {
            label: "Inspect",
            onSelect: () =>
                setInspecting({
                    cardId: selection.cardId,
                    actions: desktopPoolInspectActionsFor(selection),
                }),
        },
    ];

    // Left click on a Pool/Sideboard tile, desktop regime (issue #2861):
    // opens the menu on a short delay — the double-click window — so a
    // double click performs the zone move below instead and the menu never
    // flashes open. `desktopPoolClickPos` was captured by the CAPTURE-phase
    // listener on the desktop Pool pane's own wrapper, further down.
    const openDesktopPoolMenu = (selection: DeckZoneSelection) => {
        if (poolMenuOpenTimer.current !== null) {
            clearTimeout(poolMenuOpenTimer.current);
        }
        poolMenuOpenTimer.current = setTimeout(() => {
            poolMenuOpenTimer.current = null;
            const { x, y } = desktopPoolClickPos.current;
            setMenu({
                x,
                y,
                label:
                    selection.zone === "maindeck"
                        ? "Pool card actions"
                        : "Sideboard card actions",
                actions: desktopPoolMenuActionsFor(selection),
            });
        }, 200);
    };

    // Double click on a Pool/Sideboard tile, desktop regime (issue #2861):
    // cancels the pending menu-open (so it never appears) and moves the card
    // to the other zone — no Column named, so any existing Pin survives and a
    // Sideboard → Pool move lands wherever the current Grouping assigns it.
    const handleDesktopPoolDoubleClick = (selection: DeckZoneSelection) => {
        if (poolMenuOpenTimer.current !== null) {
            clearTimeout(poolMenuOpenTimer.current);
            poolMenuOpenTimer.current = null;
        }
        handlePoolZoneMove(selection.pinKey, selection.zone === "maindeck");
    };

    // Real right-click on a Pool/Sideboard tile, desktop regime (issue
    // #2861): opens the Inspect Overlay directly, no menu.
    const handleDesktopPoolContextMenu = (selection: DeckZoneSelection) => {
        setInspecting({
            cardId: selection.cardId,
            actions: desktopPoolInspectActionsFor(selection),
        });
    };

    // The Pool's `DeckZonePeek` panel is `fixed`, so the surface underneath
    // reserves the room it occupies — on the axis the RESOLVED layout
    // actually eats. At four of the five UI-gate viewports that is WIDTH (the
    // rail), not height. Only the PHONE path still mounts that panel (issue
    // #2861 retires the desktop one, along with the Booster's own former
    // `<PeekPanel>` — see the surface `style` below, which now reacts only to
    // `poolSelection`, itself only ever set on a phone since #2861).
    const peekLayout = usePeekPanelLayout();

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
            onPick={
                phoneOrientation === null
                    ? undefined
                    : (pickId) => void handlePick(pickId)
            }
            onOpenMenu={phoneOrientation === null ? openBoosterMenu : undefined}
            onOpenContextMenu={
                phoneOrientation === null ? undefined : openBoosterContextMenu
            }
            onInspect={
                phoneOrientation === null ? openBoosterInspect : undefined
            }
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

    // The DESKTOP Pool/Sideboard (issue #2861): no `selection`/Peek rail —
    // `onCardSelect` opens the delayed menu, `onCardDoubleClick` moves the
    // card, `onCardContextMenu` opens Inspect directly. `onPin` is still
    // required even though nothing here calls it directly (the desktop
    // menu's own "Move to…" reaches `handlePoolPin` through the ActionSheet
    // mounted below instead) — its PRESENCE is what makes
    // `DeckZoneSurface` populate `DeckZoneSelection.columns`, which is what
    // decides whether the menu offers "Move to…" at all.
    const poolPane = (
        <>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-text-muted uppercase">
                Your Pool ({pool.length})
            </h3>
            <LimitedDraftPool
                eventId={eventId}
                pool={pool}
                arrangement={seat.poolArrangement}
                onCardSelect={openDesktopPoolMenu}
                onCardDoubleClick={handleDesktopPoolDoubleClick}
                onCardContextMenu={handleDesktopPoolContextMenu}
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
        // `!poolSelection` (review finding #2797-5). Without it, on a phone
        // the pack's inline CTA row — including the destructive "Pick" — kept
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
            {/* The Pool's phone-only `DeckZonePeek` is `fixed`, so the surface
                underneath has to reserve the room it occupies — a bottom
                sheet that COVERS the last row of the Pool, or a right rail
                that covers the right 224px of the Booster grid, is the
                occlusion the five-viewport probe exists to catch. Desktop
                mounts no such panel any more (issue #2861: the Booster's own
                former `<PeekPanel>` and the Pool's desktop `<DeckZonePeek>`
                are both retired in favour of the card context menu), which is
                why the pack grid's width is now identical before and after a
                selection there — nothing left to reserve for. */}
            {/* No top border / `mt-4` any more: that was this block's
                separator from the event chrome it used to sit under (issue
                #2515's 16px accounting). The Draft Room is its own route now
                and there is nothing above the Booster to separate from. */}
            <div
                data-slot="draft-surface"
                data-layout={layout}
                className="flex min-h-0 flex-1 flex-col gap-3"
                // `poolSelection` is only ever set on a phone since issue
                // #2861 (the desktop Pool wires `onCardSelect` to
                // `openDesktopPoolMenu` instead, which never touches this
                // state) — so this reserve is now a PHONE-only concern.
                style={poolSelection ? peekPanelReserve(peekLayout) : undefined}
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
                ) : (
                    // Tablet / desktop (ADR 0101 §6, restored by issue
                    // #2820): the Booster grid full width on top, the Pool
                    // (with its Sideboard rail beside it, `arrange="row"`,
                    // the `LimitedDraftPool` default) beneath. Both bands
                    // carry `overflow-y-auto`, each-half-scrolls-on-its-own
                    // discipline the (now-removed) split arm used, just
                    // stacked vertically instead of side by side. The
                    // Booster band is NOT `shrink-0`: the persisted Booster
                    // zoom slider (`useCardZoom`, zone `limited-booster`, max
                    // 2.2, localStorage) can grow the pack grid past the
                    // surface height on its own — a pack is NOT bounded to a
                    // fixed pixel footprint — so without its own scroller the
                    // Booster instead steals height from the Pool band below
                    // it.
                    //
                    // Round-2 fixup correction (blocking review, 2nd pass):
                    // `flex: 1 1 0%`'s `flex-basis: 0` was NOT enough to
                    // protect the Pool band from that theft, because CSS flex
                    // shrinking only ever SHRINKS under negative free space —
                    // the grow factor never runs — so a tall pack's Booster
                    // absorbed the ENTIRE deficit down to the surface height
                    // while the Pool band sat at its 0 basis plus padding
                    // (measured in real Chromium at 820x1180 by the round-2
                    // review: Pool `clientHeight` 12px against a 1900px
                    // pack). The Booster's own `overflow-y-auto` (added the
                    // prior round) only changed WHERE the spillover
                    // scrolled, not whether the Pool band collapsed. The
                    // actual floor is the Pool band's explicit
                    // `min-h-[17.5rem]` (280px) below — browsers honor an
                    // EXPLICIT `min-height` as a hard floor on a flex item
                    // regardless of its shrink factor (unlike the automatic
                    // min-size flexbox computes on its own, which negative
                    // free space overrides). 280px is an EMPIRICALLY
                    // MEASURED floor, not a derived one: the Pool pane's
                    // intrinsic minimum — its "Your Pool (n)" heading, one
                    // Mana-Value column header row and one card row at this
                    // component's `CARD_MIN_W` floor, with the Sideboard
                    // rail beside it at the same height (`arrange="row"`) —
                    // measures ~233px at the tightest non-phone viewport
                    // (820x1180), and 280px clears it with ~47px of slack.
                    // Do NOT re-derive it from `cardSizing.ts:50-51`'s
                    // `calc(cardBase(...) * 7/5 + 3.5rem)`, the analogous
                    // reservation `DeckZoneSurface` applies
                    // (`deck-zone-surface.tsx:693`): that formula yields
                    // 156.8px below an 800px viewport and saturates at
                    // 224px, so it is the same IDEA at a different number,
                    // not this constant's source. Over-reserving costs only
                    // Booster height, which stays ≥417px and scrolls; below
                    // it the Pool's own `overflow-y-auto` still does its job
                    // for anything past one row. Re-measured
                    // (`chrome-devtools-mcp`, 820x1180 real Chromium, a
                    // 24-card seat, this fix): tall pack (booster zoom
                    // slider pinned to 2.2× via its persisted localStorage
                    // key, grid `scrollHeight` 3220px against a 794px
                    // Booster band) Pool `clientHeight` 279px, pinned to the
                    // floor and NOT scrolling — its one-row-per-MV-column
                    // pile content fits inside it, with the header and the
                    // Sideboard rail both visible; default-zoom pack (786px
                    // grid, well under the 1112px surface) Pool
                    // `clientHeight` 287px, unchanged by the floor (it was
                    // already above 280px on its own, confirming the short-
                    // pack case this round 1 already had right is
                    // untouched).
                    <>
                        <div
                            className="flex min-h-0 shrink flex-col gap-3 overflow-y-auto"
                            data-slot="draft-stacked-booster"
                        >
                            {packPane}
                        </div>
                        {showPool && (
                            <div
                                data-slot="draft-stacked-pool"
                                className="flex min-h-[17.5rem] flex-1 flex-col gap-3 overflow-y-auto border-t border-border-accent/20 pt-3"
                                // Issue #2861: the desktop Pool/Sideboard menu
                                // opens at the CLICK POINT, but the tile's own
                                // `onClick` carries no event (it is a plain
                                // `() => void`, shared with the BUILD view's
                                // immediate-move click). A CAPTURE-phase
                                // listener on this wrapper always runs before
                                // any descendant tile's own bubble-phase click
                                // handler, so the position is fresh by the
                                // time `openDesktopPoolMenu` reads it.
                                onClickCapture={(e) => {
                                    desktopPoolClickPos.current = {
                                        x: e.clientX,
                                        y: e.clientY,
                                    };
                                }}
                            >
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

            {inspecting && (
                <InspectOverlay
                    cardId={inspecting.cardId}
                    actions={inspecting.actions}
                    // PRD #2405 D15: in the Draft Room a tap anywhere closes,
                    // so read -> back to picking is one tap. "Pick" is exempt.
                    tapAnywhereCloses
                    onClose={() => setInspecting(null)}
                />
            )}

            {/* The Pool/Sideboard half of the PHONE selection model (issue
                #2667; desktop retired by issue #2861) — reused byte-for-byte
                from the deckbuilder rather than a second copy of its
                CTA-appending ("Move to…"/"Inspect") logic. Mounted
                unconditionally: `DeckZonePeek` itself renders nothing while
                `poolSelection` is `null` (its own internal
                `{selection && (...)}` guards) — and since issue #2861 only
                the phone panes' own `<LimitedDraftPool>` ever sets it, so
                this simply never mounts anything on desktop any more. */}
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
                    onClose={() => setMenu(null)}
                />
            )}

            {/* The desktop Pool/Sideboard menu's own "Move to…" (issue
                #2861) — the SAME `ActionSheet` the phone/build-view Peek
                Panels already open for it (`DeckZonePeek`'s own
                `pickingColumn`, above), so a player who has used either finds
                an identical sheet here. `moveSheetSelection` stays set
                through the close animation; `moveSheetOpen` is what actually
                toggles it. */}
            {moveSheetSelection && (
                <ActionSheet
                    open={moveSheetOpen}
                    onClose={() => setMoveSheetOpen(false)}
                    items={moveSheetSelection.columns.map((column) => ({
                        key: column.id,
                        label: column.label,
                        onSelect: () => {
                            handlePoolPin(
                                moveSheetSelection.cardId,
                                column.id,
                                moveSheetSelection.pinKey
                            );
                            setMoveSheetOpen(false);
                        },
                    }))}
                />
            )}
        </DragDropProvider>
    );
}
