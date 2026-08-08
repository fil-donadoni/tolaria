import type { CardInstance } from "~/types/game";
import { useManualCardInteraction } from "~/lib/manual-card-verbs";
import ManualHandCard from "./manual-hand-card";
import GreHandCard from "./gre-hand-card";

export type BoardHandCardProps = {
    /** The viewer's own hand card (never null — opponent/back slots render the
     *  presentational {@link BoardCard} instead). */
    card: CardInstance;
    /** Called on every drag move with the live pointer x (client px) so the
     *  hand container can reorder the presentation slots under the drop
     *  position (#271, fix 2). Omitted when the hand can't reorder (single
     *  card). Ignored by the Manual Board branch (its drag is the board-level
     *  `useManualDrag` gesture, not this per-card one). */
    onDragMove?: (pointerX: number) => void;
    /** Called once the drag gesture ends (release or cancel) so the hand can
     *  clear its drag-reorder bookkeeping. Ignored by the Manual Board branch. */
    onDragEnd?: () => void;
    /** Horizontal lift (px) for the dragged card given the live pointer x, so its
     *  center tracks the pointer even as its own slot reorders under it, bounded
     *  to the hand span. Supplied by the hand (which owns the slot geometry).
     *  When omitted the card falls back to the raw pointer offset. Ignored by
     *  the Manual Board branch. */
    dragTranslateX?: (pointerX: number) => number;
    /** `sizes` hint forwarded to CardImage — defaults to the landscape hand's
     *  120px slot; the portrait hand passes its 76px. */
    sizes?: string;
    /** Forwarded to CardImage. The landscape hand (120px) is a mid slot, so it
     *  excludes `thumb` (default false); the portrait hand (76px) keeps it. */
    includeThumb?: boolean;
    /** Called whenever this card's touch STAGE (#1767) opens or closes, so the
     *  hand can raise the card's whole SLOT above its neighbours. The card's own
     *  inner `zIndex` is enough for the portrait row (plain flow siblings), but
     *  NOT for the spatial fan: the slot's DOM node never reorders (the same
     *  reason the dragged slot needs `snap`), so an inner z-index can't lift it
     *  over later-painted siblings — only the slot can. Omitted by hands that
     *  don't stack their cards. Ignored by the Manual Board branch (it has no
     *  tap-stage gesture). */
    onStagedChange?: (staged: boolean) => void;
    /** The card's root disables all native touch gestures (`touch-action:
     *  none`) by default so a touch swipe never scrolls/zooms the page
     *  instead of driving the drag-to-cast gesture. The spatial (landscape)
     *  hand relies on that: it has no scrollable ancestor, and horizontal
     *  pointer movement there drives the JS drag-reorder, not a native pan.
     *  The portrait hand (#336) is DIFFERENT: above the scroll threshold its
     *  row is `overflow-x-auto`, and a touch swipe over a card is the ONLY
     *  way to reach cards past the right edge — but `touch-action: none`
     *  starting on a card blocks the browser from ever recognizing that swipe
     *  as a native scroll, regardless of any JS `preventDefault` (issue
     *  #1994: "10-12 cards in hand on mobile, can't reach the ones past the
     *  right edge"). Set `true` there: `touch-action: pan-x` still lets the
     *  vertical drag-to-cast gesture reach JS (native Y panning is disabled),
     *  while a horizontal swipe is handed to the browser's own scroll.
     *  Omitted ⇒ `touch-none` (unchanged spatial-hand behavior). Ignored by
     *  the Manual Board branch. */
    allowHorizontalPan?: boolean;
};

/** Interactive hand card for the spatial board (PRD #249, slice #254) — a
 *  thin dispatcher between the two hand-card variants (issue #2347, split
 *  out on the PR #2359 review):
 *
 *  - `useManualCardInteraction()` present (only under
 *    `ManualCardInteractionProvider`, `manual-board-view.tsx`) → renders
 *    {@link ManualHandCard}, which calls NO GRE hook at all.
 *  - Absent (every GRE board, the default) → renders {@link GreHandCard},
 *    unchanged behaviour.
 *
 *  This split exists because the two variants used to live in ONE function
 *  that called every GRE hook unconditionally before branching late in its
 *  body. `useHandCardCommit` (one of those hooks) is not pure — it reads a
 *  `CardDefinition` via `getDefinition`, which THROWS for an id the card
 *  registry doesn't know. A Manual Game's hand card ids are Full Catalogue
 *  PRINT ids (ADR 0080 forbids hydrating a `CardDefinition` for them), and
 *  the Tabletop deck builder's pool is the whole ~27K catalogue — including
 *  cards the GRE does not implement — so any Tabletop hand holding an
 *  unimplemented card crashed the real board on render, with no
 *  ErrorBoundary above it to catch it.
 *
 *  Skipping the GRE hooks with an early return INSIDE that one function
 *  would still be a real `react-hooks/rules-of-hooks` violation — ESLint
 *  flags any hook call reachable after a conditional return, regardless of
 *  whether the branch is provably stable for a given mounted instance (it
 *  is here: which provider wraps a `BoardHandCard` never changes across that
 *  instance's lifetime). So the fix is a genuine component split: THIS
 *  component calls exactly one hook (`useManualCardInteraction`,
 *  unconditionally) and then renders one of two SEPARATE components, each of
 *  which calls its own hooks unconditionally in its own right — standard
 *  conditional rendering, not a conditional hook call. */
export default function BoardHandCard(props: BoardHandCardProps) {
    const manualInteraction = useManualCardInteraction();
    if (manualInteraction) {
        return (
            <ManualHandCard
                card={props.card}
                manualInteraction={manualInteraction}
                sizes={props.sizes}
                includeThumb={props.includeThumb}
            />
        );
    }
    return <GreHandCard {...props} />;
}
