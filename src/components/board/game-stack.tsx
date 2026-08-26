import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import { matchesSpellPendingTarget, wantsSpellTarget } from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useDraggable } from "~/hooks/useDraggable";
import { repositionAnchors } from "~/hooks/anchor-reposition";
import { Panel } from "~/components/ui/panel";
import { PORTRAIT_STACK_PANEL_TOP } from "~/lib/portrait-board-bands";
import {
    BESIDE_CONTROLLER_STRIP,
    CONTROLLER_STRIP_CLEARANCE_EXPR,
} from "~/lib/controller-bar-metrics";
import DragHandle from "./drag-handle";
import StackRow from "./stack-row";

/** Portrait's clearance-bound bottom edge — the SAME literal Tailwind class
 *  the viewer battlefield band itself uses for this edge
 *  (`PORTRAIT_VIEWER_BATTLEFIELD_BAND`, `portrait-board-bands.ts`), typed out
 *  directly rather than template-built from `PORTRAIT_VIEWER_BF_BOTTOM_VAR`
 *  (issue #1816 review fixup finding 6). A template-built arbitrary-value
 *  class (`` `bottom-[var(${VAR})]` ``) only worked here because the
 *  IDENTICAL literal happened to already appear, spelled out, inside
 *  `PORTRAIT_VIEWER_BATTLEFIELD_BAND` — Tailwind's JIT scanner greps SOURCE
 *  TEXT for literal class occurrences, it does not evaluate JS template
 *  interpolation, so a `${}`-built class name is invisible to it unless the
 *  fully-resolved string ALSO appears verbatim somewhere it scans. A refactor
 *  of that other constant (e.g. a var rename) would have silently stopped
 *  generating this class's CSS with no compiler error — this file compiled
 *  for a reason that had nothing to do with this file.
 *  `game-stack-narrow.test.tsx` asserts this literal is a substring of
 *  `PORTRAIT_VIEWER_BATTLEFIELD_BAND` so a future rename of that shared
 *  fragment fails the guard instead of silently breaking this class.
 *
 *  Pinning the panel's bottom here (rather than a vh-based `max-h`) makes
 *  "never overlaps the controller bar or the viewer's hand" an arithmetic
 *  guarantee: that var already bakes in the bar's MEASURED clearance, the
 *  hand band, and the reserved nameplate band, so the stack panel stops
 *  exactly where the viewer's own battlefield does. */
export const NARROW_BOTTOM_CLASS = "bottom-[var(--portrait-viewer-bf-bottom)]";

type GameStackProps = {
    stack: StackItem[];
    /** Issue #1813 review fixup round 2 (#1823), re-tiered by #1885 —
     *  portrait's `BoardPortraitChips` toggles this panel from the stack
     *  chip. The panel renders at the `z-stack` tier (`src/index.css`), one
     *  rung BELOW a centered pending-choice prompt's `z-banner` tier
     *  (`usePromptBannerPosition`): with the panel open by DEFAULT (#1816)
     *  it is passive, ambient chrome, and a choice surface must always win
     *  over it — at the panel's old `z-chip` tier a centered prompt
     *  rendered BEHIND the open stack (#1885). The chip ROW keeps `z-chip`
     *  (above the banner — collapsing/opening the stack stays reachable
     *  under any prompt), and everything here stays strictly BELOW
     *  `z-modal`, so a real blocking modal (trigger-order-prompt,
     *  mana-choice-picker, the reveal overlays) still owns the screen
     *  outright. Set only by the portrait toggle path; desktop's always-on
     *  mount leaves this unset (unchanged `z-modal` — no chip, no banner
     *  collision to fix there). */
    elevated?: boolean;
    /** Issue #1816 — portrait's `BoardPortraitChips` now opens this panel by
     *  DEFAULT whenever the stack is non-empty (not only after a tap), so it
     *  is on-screen far more of the time than the old tap-to-reveal panel.
     *  Two changes, both portrait-only (desktop's always-on mount leaves this
     *  unset and is byte-for-byte unchanged):
     *
     *  1. Narrower: `w-96` (384px, the desktop width, unchanged for desktop)
     *     shrinks to `w-72` (288px) — still wide enough for a readable
     *     `StackRow` (art tile + name/mana/oracle column), but leaves more of
     *     a ~390px phone's board visible behind it.
     *  2. Re-anchored: the desktop panel is vertically CENTERED
     *     (`top-1/2` + a `-50%` translate) with a `max-h-[80vh]` soft cap —
     *     tall enough on a short phone to run under the hand strip and the
     *     bottom bar. The narrow panel instead anchors between
     *     `PORTRAIT_STACK_PANEL_TOP` (issue #1816 review fixup finding 2 —
     *     PAST the midline by the stack chip's own height plus a gap, NOT
     *     the bare midline the chip itself sits on: the panel used to start
     *     exactly there and, mounting later in the DOM at the same
     *     `z-chip` tier, painted over the chip's bottom half, leaving under
     *     half the 44px touch target tappable) and
     *     {@link NARROW_BOTTOM_CLASS} (the viewer battlefield's own bottom
     *     inset, i.e. clear of the bar, the hand band AND the nameplate
     *     band) — both edges pinned, so the browser computes its height as
     *     the gap between them and it can never grow into either. */
    narrow?: boolean;
    /** Issue #2589 — landscape-compact's chip-triggered right panel (ADR 0101
     *  §8: "a bottom sheet from the Stack chip in portrait and a right panel
     *  in landscape"). Toggled from `ControllerLandscapeStrip`, the SAME
     *  seam `ControllerPhasePanel` already anchors beside — mutually
     *  exclusive with `narrow` (a viewport is never both portrait and
     *  landscape-compact at once).
     *
     *  Shape: the desktop panel's own vertical-center + `max-h-[80vh]` cap
     *  (a landscape phone is short too, so the same soft cap fits), just
     *  narrower (`w-72`, matching `narrow`'s width) and anchored BESIDE the
     *  control strip via {@link BESIDE_CONTROLLER_STRIP} — the strip's own
     *  MEASURED width (`--controller-strip-w`) — instead of the desktop's
     *  fixed `right: 0.5rem`, so the panel slides clear of the strip
     *  automatically and never hard-codes its neighbour's size. */
    landscape?: boolean;
    /** Round-2 review finding 6 (issue #2589) — how much FURTHER left the
     *  `landscape` panel must sit, beyond the control strip clearance alone,
     *  to clear the pile column (`LANDSCAPE_OPPONENT_PILES_ANCHOR` /
     *  `LANDSCAPE_VIEWER_PILES_ANCHOR`) that docks at the SAME
     *  `BESIDE_CONTROLLER_STRIP` seam. Without it the panel — open by
     *  DEFAULT whenever the stack is non-empty, at a higher z-index than the
     *  piles — painted directly over graveyard/library/exile, making both
     *  seats' pile chips unclickable for as long as anything sat on the
     *  stack. Pass `landscapePileTilePx(viewportHeight) +
     *  LANDSCAPE_PILE_EDGE_GAP_PX` (`~/lib/landscape-board-bands`) — the
     *  caller's job, not this component's, since it isn't a DOM descendant
     *  of the board root the CSS var equivalent (`--landscape-right-rail`)
     *  is scoped to (`ControllerLandscapeStrip` mounts as board-surface's
     *  SIBLING under `board.tsx`'s `<main>`, so CSS custom property
     *  inheritance — which follows the DOM tree, not the React tree — never
     *  reaches it). Ignored when `landscape` is falsy. */
    landscapePileClearancePx?: number;
};

/** How many top rows the collapsed list shows before the "N more" expander. */
const COLLAPSED_ROWS = 3;

/** The readable stack (phase 2, winner B — replaces the 50%-overlap cascade):
 *  a vertical list of card-forward rows — resolve order, controller, name +
 *  mana pips, chosen mode, FULL oracle text, and every target as a chip. The
 *  target ARROWS show by default for the top item and switch to any hovered
 *  row's relationship (the shared arrow-highlight channel dims the rest).
 *
 *  Kept from the old cascade: shared-layout flights (hand → stack →
 *  destination, layoutId per item), the draggable panel (re-anchoring arrows
 *  via the shared reposition event), spell-target clicks, arrival glow. */
export default function GameStack({
    stack,
    elevated,
    narrow,
    landscape,
    landscapePileClearancePx,
}: GameStackProps) {
    const {
        gameId,
        playerId,
        pendingTarget,
        allPlayers,
        activePlayerId,
        recentArrivals,
    } = useGameContext();
    const selectTarget = useMutation(api.game.selectTarget);
    const { offset, dragHandlers } = useDraggable();
    const highlight = useArrowHighlight();
    const setSeed = highlight?.setSeed;
    const [expanded, setExpanded] = useState(false);

    // Display in LIFO order: last cast on top (first row).
    const reversed = [...stack].reverse();

    // No default seed: EVERY stack item's target arrows are drawn at full
    // strength as soon as it hits the stack. Seeding the top item dimmed every
    // other relationship to 14% — with 2+ items on the stack the board read as
    // having no arrows at all. Hovering a row still isolates its relationship;
    // leaving clears back to "all lit".
    useEffect(() => {
        if (!setSeed) return;
        return () => setSeed(null);
    }, [setSeed]);

    // The panel moves via CSS transform, which fires no resize/scroll event,
    // so target arrows would keep stale endpoints. Re-anchor them on every
    // offset change — this runs each pointermove during a drag.
    useEffect(() => {
        repositionAnchors();
    }, [offset.x, offset.y]);

    const canTargetSpell =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        wantsSpellTarget(pendingTarget.targetType);

    const visible = expanded ? reversed : reversed.slice(0, COLLAPSED_ROWS);
    const hidden = reversed.length - visible.length;

    return (
        <div
            data-testid="game-stack"
            // Anchored to the VIEWPORT right edge (QA): parked at the play
            // area's edge (`--right-piles-w`) the panel reached far enough left
            // to sit under every play-area-centered dialog (card placement,
            // pickers). Pushing it fully right clears them; the panel is
            // draggable if a pile underneath needs a look.
            //
            // `narrow` (portrait, #1816) swaps the desktop's vertical-center
            // anchor (`top-1/2` + a `-50%` translate, `max-h-[80vh]` soft cap)
            // for a BOUNDED one: `PORTRAIT_STACK_PANEL_TOP` (past the midline,
            // clear of the stack chip — review fixup finding 2) down to
            // `NARROW_BOTTOM_CLASS`, both pinned, so the browser derives the
            // box's height as AT MOST the gap between them — it cannot run
            // under the hand strip or the bottom bar the way the vh-based cap
            // could on a short phone.
            // `pointer-events-none` on the narrow branch only (review fixup
            // round 4, finding 1): this outer div is `position: absolute`
            // with BOTH `top` and `bottom` pinned, so per CSS's auto-height
            // resolution it spans the FULL clearance between them regardless
            // of the Panel's actual (smaller) content height — a transparent
            // hit-testing column sitting over the battlefield viewer wherever
            // the Panel doesn't fill it, swallowing taps meant for the
            // permanents underneath (the permanent branch of
            // spell-or-permanent targeting was unreachable through it).
            // `pointer-events-auto` is restored on the `Panel` below so the
            // drag handle and the clickable stack rows — both DOM
            // descendants of `Panel`, not of this div — stay interactive.
            // Desktop (`!narrow`, `!landscape`) is untouched: its box is
            // centered/vh-capped, not edge-pinned, so it never grows past its
            // own content.
            //
            // `landscape` (issue #2589) reuses the desktop's vertical-center
            // shape (never edge-pinned, so no `pointer-events-none` trick is
            // needed either) but anchors its RIGHT edge beside the control
            // strip via `BESIDE_CONTROLLER_STRIP` instead of the desktop's
            // fixed `right: 0.5rem` inline style below — see the class list
            // for why that means omitting the inline `right` for this
            // branch, not adding a second one.
            className={`absolute ${
                narrow
                    ? `${PORTRAIT_STACK_PANEL_TOP} ${NARROW_BOTTOM_CLASS} pointer-events-none`
                    : landscape
                      ? `${BESIDE_CONTROLLER_STRIP} top-1/2`
                      : "top-1/2"
            } ${elevated ? "z-stack" : "z-modal"}`}
            style={{
                // `landscape` gets its `right` from the class above
                // (`BESIDE_CONTROLLER_STRIP`'s `right-[calc(...)]`) UNLESS
                // the caller passed `landscapePileClearancePx` (round-2
                // review finding 6), in which case an inline `right` here
                // WINS the cascade over the class (inline styles beat
                // classes) and pushes the panel further left, clear of the
                // pile column that docks at the SAME `BESIDE_CONTROLLER_STRIP`
                // seam — without this, the two constants happening to be
                // the same offset means the panel's own extending width
                // paints directly over the piles.
                right:
                    landscape && landscapePileClearancePx != null
                        ? `calc(${CONTROLLER_STRIP_CLEARANCE_EXPR} + ${landscapePileClearancePx}px)`
                        : landscape
                          ? undefined
                          : "0.5rem",
                transform: narrow
                    ? `translate(${offset.x}px, ${offset.y}px)`
                    : `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            {/* overflow-visible, NOT -hidden: a spell flying in from the hand
                mounts inside this panel, and clipping it to the panel box would
                hide the flight until it crosses the boundary. */}
            <div
                // `h-full`, NOT `max-h-full` (issue #1816 review fixup round 3,
                // finding 2 — the round-2 fix broke this).
                //
                // The CHAIN: OUTER positioned div (both `top` and `bottom`
                // pinned) → THIS transparent wrapper → `Panel` (`max-h-full`)
                // → its scrollable body (`flex-1 min-h-0 overflow-y-auto`).
                // Round 2 reasoned the outer div "already has a definite
                // height" and gave THIS wrapper `max-h-full` too, on the
                // theory that a percentage cap here would resolve against
                // that outer definite height. It doesn't: a CSS percentage
                // height (`max-height: 100%` included) only resolves against
                // an ancestor whose OWN computed height is a definite,
                // non-auto value — and `max-height` alone does not make a
                // box's height definite, it only ever caps whatever height
                // the box would otherwise take. This wrapper is an ordinary
                // block with no other height source, so with only
                // `max-h-full` its used height stayed `auto` (shrink-to-fit
                // content) — a non-definite value. That left `Panel`'s OWN
                // `max-h-full` one level down resolving against `auto` too,
                // i.e. against nothing (`max-height: none`), so a long stack
                // could grow past the outer box's real bottom edge and
                // overrun `--portrait-viewer-bf-bottom` into the hand /
                // controller bar.
                //
                // `h-full` (`height: 100%`) on THIS wrapper is what makes its
                // computed height definite — it FIXES this wrapper's box to
                // the outer div's real clearance, unconditionally. That's
                // safe to force unconditionally here (unlike on `Panel`
                // below) because this wrapper carries no background/border —
                // it is pure layout, invisible either way; forcing its box to
                // the full clearance doesn't render an oversized visible
                // panel. `Panel`'s OWN `max-h-full` then resolves against a
                // now-definite 100% and is genuinely a CAP: `Panel` is a
                // `flex flex-col` block that still sizes to ITS content (a
                // single-item stack renders a small box, same as before)
                // — max-height only kicks in once content would exceed the
                // wrapper's height, at which point the body's own
                // `overflow-y-auto` scrolls instead of the panel growing
                // further. Verified against
                // `game-stack-narrow.test.tsx`'s guard.
                //
                // Pointer-events check (asked for explicitly in review):
                // giving this wrapper a real `h-full` box does NOT create a
                // new dead click-catching area over the board beyond what the
                // OUTER div already occupied. The OUTER div above is
                // `position: absolute` with BOTH `top` and `bottom` set —
                // per CSS's auto-height resolution for absolutely positioned
                // boxes, that already forces the outer div's own box to span
                // the full clearance regardless of this wrapper's height,
                // background-free or not. This wrapper's `h-full` box exactly
                // coincides with a region the outer div already occupied; no
                // additional page area becomes hit-testable that wasn't
                // already. That outer box IS, however, hit-testable itself
                // wherever it's transparent (the actual bug fixed at its own
                // definition site above, review fixup round 4 finding 1) —
                // this wrapper carries no `pointer-events` class of its own
                // and doesn't need one: it inherits `pointer-events-none`
                // from the outer div, and `Panel` below overrides back to
                // `pointer-events-auto` for itself and its descendants.
                className={`relative overflow-visible ${narrow ? "h-full" : ""}`}
            >
                <Panel
                    density="compact"
                    className={`${
                        narrow
                            ? "flex max-h-full w-72 flex-col pointer-events-auto"
                            : landscape
                              ? "max-h-[80vh] w-72"
                              : "max-h-[80vh] w-96"
                    } max-w-[92vw] overflow-visible p-0`}
                >
                    <DragHandle
                        label={`Stack (${stack.length})`}
                        handlers={dragHandlers}
                    />
                    <div
                        className={`flex ${
                            narrow ? "min-h-0 flex-1" : "max-h-[70vh]"
                        } flex-col gap-2 overflow-y-auto p-2`}
                    >
                        {visible.map((item, i) => {
                            // ADR 0068 / issue #1956 — ONE composed predicate
                            // covering every client-checked spell filter (the
                            // per-filter chain that used to live here is where
                            // a newly added filter silently went missing).
                            const isTargetable =
                                canTargetSpell &&
                                matchesSpellPendingTarget(item, pendingTarget, {
                                    playerId,
                                    activePlayerId,
                                    players: allPlayers,
                                });

                            const dimmed =
                                highlight?.nodes != null &&
                                !highlight.nodes.has(item.id);

                            return (
                                <StackRow
                                    key={item.id}
                                    item={item}
                                    order={i + 1}
                                    isTop={i === 0}
                                    isTargetable={!!isTargetable}
                                    onSelect={() => {
                                        if (!isTargetable) return;
                                        selectTarget({
                                            gameId,
                                            playerId,
                                            targetType: "spell",
                                            targetId: item.id,
                                        });
                                    }}
                                    onHoverSeed={(seeding) => {
                                        if (!setSeed) return;
                                        setSeed(
                                            seeding ? { nodeId: item.id } : null
                                        );
                                    }}
                                    dimmed={dimmed}
                                    arrived={
                                        recentArrivals?.has(item.id) === true
                                    }
                                    allPlayers={allPlayers}
                                    viewerId={playerId}
                                    stack={stack}
                                    // Phone panels only (issue #2727): both
                                    // of these cover the board the arrows
                                    // cross, so the row names its targets in
                                    // text there and nowhere else.
                                    showTargetLine={!!narrow || !!landscape}
                                />
                            );
                        })}
                        {hidden > 0 && (
                            <button
                                type="button"
                                className="rounded-sm border border-border-subtle px-2 py-1 text-center text-[10px] text-accent-strong hover:bg-accent-soft/20"
                                onClick={() => setExpanded(true)}
                                onMouseEnter={() => setExpanded(true)}
                            >
                                ▾ {hidden} more below
                            </button>
                        )}
                    </div>
                </Panel>
            </div>
        </div>
    );
}
