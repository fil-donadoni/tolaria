import { useEffect, useRef, useState } from "react";
import type { Player, StackItem } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { PORTRAIT_MIDLINE_TOP } from "~/lib/portrait-board-bands";
import BoardPileChips from "./board-pile-chips";
import StackChip from "./stack-chip";
import GameStack from "./game-stack";

type BoardPortraitChipsProps = {
    /** Opponent and viewer, in either order — the opponent is looked up by
     *  IDENTITY (viewer id from context), never by array position (#1815
     *  review fixup, finding 5): a missing opponent seat left `orderedPlayers`
     *  a 1-element array whose sole (viewer's own) entry landed in the
     *  positional `opponent` slot, mislabeling the viewer's chips as the
     *  opponent's board-level row. */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Portrait chip overlay (#336) — the phone replacement for the desktop
 *  right-edge control column. The space-eating pile columns and the always-on
 *  floating stack panel are gone; instead:
 *
 *  - opponent's graveyard / library / exile collapse to a chip row pinned
 *    top-left (clear of the opponent life pill on the top-right),
 *  - a stack chip sits at the right of the midline — the neutral band between
 *    the two battlefields — and toggles the EXISTING {@link GameStack} overlay,
 *    which is OPEN BY DEFAULT the instant the stack is non-empty (issue
 *    #1816): the chip only tracks whether the player explicitly collapsed
 *    THIS stack run, a preference that resets — panel open again — the next
 *    time the stack refills after emptying.
 *
 *  **The VIEWER's own graveyard / library / exile are NOT mounted here any
 *  more (#1815 review fixup).** An earlier revision mirrored the opponent's
 *  row to the bottom-left, anchored above the hand band — reviewed and
 *  reverted: on a 667×106 phone the reserved band tops out at ~37px while the
 *  chip row needs 44px (`min-h-11`), so it either overlapped the battlefield's
 *  own back row or starved the card-width floor (≥44px) that same band
 *  budget guarantees elsewhere (`portrait-board-bands.ts`). The viewer's row
 *  now mounts INLINE in the controller bottom bar instead
 *  (`controller-bottom-bar.tsx`, `BoardPileChips`'s `compact` mode) — see that
 *  module's doc comment for the full account, including the accepted
 *  opponent-top / viewer-in-bar asymmetry.
 *
 *  This is still the sole portrait mount of {@link BoardPileChips} for the
 *  OPPONENT'S seat. The viewer's own mount (in the bottom bar) is likewise the
 *  sole mount of `PlayerLibrary` / `PlayerGraveyard` / `PlayerExile` for that
 *  seat, which matters beyond display: those own the BLOCKING pile choice
 *  surfaces (`LibraryOrderPicker`, the `forceOpen` pile grids for library
 *  search / graveyard / exile picks). Because the bar is always mounted AND
 *  always visible (no `hidden` wrapper, no drawer to open), those surfaces
 *  are on-screen the instant a choice goes pending — no force-open plumbing
 *  needed; there is nothing to force open any more.
 *
 *  Every chip opens the EXISTING reveal / stack view (the pile components in
 *  controlled-open mode, the stack panel toggled) — nothing is rebuilt. Mounted
 *  only on the portrait branch; landscape/desktop keep {@link BoardPiles}.
 *  View layer only. */
export default function BoardPortraitChips({
    orderedPlayers,
    stackItems,
}: BoardPortraitChipsProps) {
    const { playerId } = useGameContext();
    const opponent = orderedPlayers.find((p) => p.id !== playerId);
    // Issue #1816 — the panel is OPEN BY DEFAULT whenever the stack is
    // non-empty; the chip only tracks whether the player has explicitly
    // collapsed THIS stack run. `userClosed` starts false, so a fresh mount
    // with an already non-empty stack (the common case: navigating onto a
    // board mid-resolution) shows the panel with no tap required.
    const [userClosed, setUserClosed] = useState(false);
    // Reset the collapse preference the instant a NEW stack run begins (the
    // stack count going 0 → >0) — "collapsed preference need not persist
    // across stack clears" (issue spec). A ref (not state) tracks the
    // previous length purely to detect that one transition; it never drives
    // a render itself.
    const prevStackLenRef = useRef(stackItems.length);
    useEffect(() => {
        const prevLen = prevStackLenRef.current;
        prevStackLenRef.current = stackItems.length;
        if (prevLen === 0 && stackItems.length > 0) {
            setUserClosed(false);
        }
    }, [stackItems.length]);
    const stackOpen = stackItems.length > 0 && !userClosed;

    return (
        <>
            {opponent && (
                <div
                    className="absolute left-2 top-2 z-30"
                    data-testid="pile-chips-row-opponent"
                >
                    <BoardPileChips player={opponent} />
                </div>
            )}

            {/* The midline is the shared band boundary (#1760), which sits
                half the bottom bar's clearance above the viewport centre — not
                a literal `top-1/2`, or the chip would drift into the viewer's
                battlefield.
                z-chip (issue #1813 review fixup round 2, #1823) — NOT
                z-modal-top. A centered pending-choice banner now renders at
                the lower `z-banner` tier (`usePromptBannerPosition`), and
                `z-chip` sits one rung above it so this chip stays tappable
                regardless of what prompt is showing — but strictly BELOW
                `z-modal`, so a real blocking modal (trigger-order-prompt,
                mana-choice-picker, the reveal overlays) still wins outright
                rather than the chip painting through its scrim. See
                `src/index.css`'s `--z-banner`/`--z-chip`/`--z-modal` comment
                for the full 3-rung rationale. */}
            <div
                className={`absolute right-2 ${PORTRAIT_MIDLINE_TOP} z-chip -translate-y-1/2`}
                data-testid="stack-chip-row"
            >
                <StackChip
                    count={stackItems.length}
                    open={stackOpen}
                    onToggle={() => setUserClosed((v) => !v)}
                />
            </div>

            {/* The stack overlay is the EXISTING panel, toggled by the chip
                instead of being always-on. `elevated` (issue #1813 review
                fixup, #1823) puts it at the SAME `z-chip` tier as the chip
                above — opening the stack is an explicit player action; it
                must out-rank the (lower) centered pending-choice banner, but
                — like the chip — stay below any real blocking modal.
                `narrow` (issue #1816) is the SAME portrait-only distinction:
                since this panel is now open by DEFAULT (not only after a
                tap), it renders narrower and clearance-bound to the midline /
                viewer-battlefield-bottom instead of the desktop's vertically
                centered, vh-capped box — see `GameStack`'s own doc comment. */}
            {stackOpen && stackItems.length > 0 && (
                <GameStack stack={stackItems} elevated narrow />
            )}
        </>
    );
}
