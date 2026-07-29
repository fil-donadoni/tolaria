import { useState } from "react";
import type { Player, StackItem } from "~/types/game";
import {
    PORTRAIT_MIDLINE_TOP,
    PORTRAIT_VIEWER_CHIPS_BOTTOM,
} from "~/lib/portrait-board-bands";
import BoardPileChips from "./board-pile-chips";
import StackChip from "./stack-chip";
import GameStack from "./game-stack";

type BoardPortraitChipsProps = {
    /** Opponent first, viewer second (same ordering as the rest of Board). */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Portrait chip overlay (#336) — the phone replacement for the desktop
 *  right-edge control column. The space-eating pile columns and the always-on
 *  floating stack panel are gone; instead:
 *
 *  - opponent's graveyard / library / exile collapse to a chip row pinned
 *    top-left (clear of the opponent life pill on the top-right),
 *  - the VIEWER's own graveyard / library / exile collapse to the SAME chip
 *    row, mirrored to the bottom-left — always visible, symmetric with the
 *    opponent's (#1815). It used to float at `bottom-24` (untappable once the
 *    variant-D bottom bar, #1759, covers that band), then got relocated behind
 *    a "Zones" tab in that bar (an extra tap to reach something both players'
 *    boards show for free). Both problems are the same one: the row's own
 *    anchor never accounted for the bar OR the hand strip. It now anchors to
 *    {@link PORTRAIT_VIEWER_CHIPS_BOTTOM} — the viewer battlefield's own
 *    measured bottom inset (bar clearance + hand band) — so it sits directly
 *    above the interactive hand fan without covering it, with no separate
 *    drawer / tab required to reach it. The Zones tab is gone from the bottom
 *    bar; tapping a chip opens the reveal dialog directly, same gesture as the
 *    opponent's row.
 *  - a stack chip sits at the right of the midline — the neutral band between
 *    the two battlefields — and toggles the EXISTING {@link GameStack} overlay.
 *
 *  This is still the SOLE portrait mount of {@link BoardPileChips} for both
 *  seats, which matters beyond display: the viewer's row is also the sole
 *  mount of `PlayerLibrary` / `PlayerGraveyard` / `PlayerExile`, which own the
 *  BLOCKING pile choice surfaces (`LibraryOrderPicker`, the `forceOpen` pile
 *  grids for library search / graveyard / exile picks). Because this row is
 *  always mounted AND always visible (no `hidden` wrapper, no drawer to open),
 *  those surfaces are on-screen the instant a choice goes pending — no
 *  force-open plumbing needed; there is nothing to force open any more.
 *
 *  Every chip opens the EXISTING reveal / stack view (the pile components in
 *  controlled-open mode, the stack panel toggled) — nothing is rebuilt. Mounted
 *  only on the portrait branch; landscape/desktop keep {@link BoardPiles}.
 *  View layer only. */
export default function BoardPortraitChips({
    orderedPlayers,
    stackItems,
}: BoardPortraitChipsProps) {
    const [opponent, viewer] = orderedPlayers;
    const [stackOpen, setStackOpen] = useState(false);

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

            {viewer && (
                <div
                    className={`absolute left-2 ${PORTRAIT_VIEWER_CHIPS_BOTTOM} z-30`}
                    data-testid="pile-chips-row-viewer"
                >
                    <BoardPileChips player={viewer} />
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
                    onToggle={() => setStackOpen((v) => !v)}
                />
            </div>

            {/* The stack overlay is the EXISTING panel, toggled by the chip
                instead of being always-on. `elevated` (issue #1813 review
                fixup, #1823) puts it at the SAME `z-chip` tier as the chip
                above — opening the stack is an explicit player action; it
                must out-rank the (lower) centered pending-choice banner, but
                — like the chip — stay below any real blocking modal. */}
            {stackOpen && stackItems.length > 0 && (
                <GameStack stack={stackItems} elevated />
            )}
        </>
    );
}
