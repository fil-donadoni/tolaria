import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StackItem } from "~/types/game";
import {
    matchesSpellTypeFilter,
    matchesSpellExcludeTypeFilter,
    matchesSpellCreaturePtFilter,
    matchesSpellSingleTargetingController,
    matchesSpellController,
    matchesSpellWouldDestroyLand,
    matchesStackObjectFilter,
    wantsSpellTarget,
} from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import { useDraggable } from "~/hooks/useDraggable";
import { repositionAnchors } from "~/hooks/anchor-reposition";
import { Panel } from "~/components/ui/panel";
import { PORTRAIT_STACK_PANEL_TOP } from "~/lib/portrait-board-bands";
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
    /** Issue #1813 review fixup round 2 (#1823) — portrait's
     *  `BoardPortraitChips` toggles this panel from the stack chip. Opening
     *  the stack is an explicit player action, so it renders at the `z-chip`
     *  tier (`src/index.css`) — one rung ABOVE a centered pending-choice
     *  prompt's `z-banner` tier (`usePromptBannerPosition`), so it is never
     *  swallowed by that banner, but strictly BELOW `z-modal`, so a real
     *  blocking modal (trigger-order-prompt, mana-choice-picker, the reveal
     *  overlays) still owns the screen outright rather than the panel
     *  painting through its scrim. Set only by the portrait toggle path;
     *  desktop's always-on mount leaves this unset (unchanged `z-modal` —
     *  no chip, no centered-banner collision to fix there). */
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
export default function GameStack({ stack, elevated, narrow }: GameStackProps) {
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
            className={`absolute ${
                narrow
                    ? `${PORTRAIT_STACK_PANEL_TOP} ${NARROW_BOTTOM_CLASS}`
                    : "top-1/2"
            } ${elevated ? "z-chip" : "z-modal"}`}
            style={{
                right: "0.5rem",
                transform: narrow
                    ? `translate(${offset.x}px, ${offset.y}px)`
                    : `translate(${offset.x}px, calc(-50% + ${offset.y}px))`,
            }}
        >
            {/* overflow-visible, NOT -hidden: a spell flying in from the hand
                mounts inside this panel, and clipping it to the panel box would
                hide the flight until it crosses the boundary. */}
            <div
                // `max-h-full`, NOT `h-full` (issue #1816 review fixup finding
                // 5): the OUTER positioned div above already has a definite
                // height (both `top` and `bottom` are pinned, so the browser
                // solves the gap between them per CSS's auto-height rule for
                // absolutely-positioned boxes) — but this inner wrapper and
                // the `Panel` below it are ordinary block children, which size
                // to CONTENT by default. `h-full` used to force them to that
                // full clearance gap regardless of how little the stack
                // actually held, rendering an opaque box most of the way down
                // the board even for a single-item stack. `max-h-full` keeps
                // the same upper bound (never grows past the clearance) while
                // letting the box shrink to its real content — the same
                // technique the desktop variant already uses via
                // `max-h-[80vh]` with no explicit `height`.
                className={`relative overflow-visible ${narrow ? "max-h-full" : ""}`}
            >
                <Panel
                    density="compact"
                    className={`${
                        narrow
                            ? "flex max-h-full w-72 flex-col"
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
                            const isTargetable =
                                canTargetSpell &&
                                matchesSpellTypeFilter(
                                    item,
                                    pendingTarget?.spellTypeFilter
                                ) &&
                                matchesSpellExcludeTypeFilter(
                                    item,
                                    pendingTarget?.spellExcludeTypeFilter
                                ) &&
                                matchesSpellCreaturePtFilter(
                                    item,
                                    pendingTarget?.spellCreaturePtFilter
                                ) &&
                                matchesSpellSingleTargetingController(
                                    item,
                                    pendingTarget?.spellSingleTargetingController,
                                    playerId
                                ) &&
                                matchesSpellController(
                                    item,
                                    pendingTarget?.controller,
                                    playerId,
                                    activePlayerId
                                ) &&
                                matchesSpellWouldDestroyLand(
                                    item,
                                    pendingTarget?.spellWouldDestroyLandYouControl,
                                    allPlayers,
                                    playerId
                                ) &&
                                matchesStackObjectFilter(
                                    item,
                                    pendingTarget?.spellStackKind,
                                    pendingTarget?.stackSourceTypeFilter,
                                    pendingTarget?.spellTargetsInstanceIds
                                );

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
