import { useState } from "react";
import type { Player, StackItem } from "~/types/game";
import { PORTRAIT_MIDLINE_TOP } from "~/lib/portrait-board-bands";
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
 *  - a stack chip sits at the right of the midline — the neutral band between
 *    the two battlefields — and toggles the EXISTING {@link GameStack} overlay.
 *
 *  The VIEWER's own pile chips are RELOCATED, not removed: they used to float
 *  at `bottom-24`, which the variant-D bottom bar (#1759) now covers, making
 *  them untappable. The same {@link BoardPileChips} row — same component, same
 *  reveal dialogs — is now mounted by that bar's Zones drawer
 *  ({@link ControllerZonesDrawer}), permanently and for the whole game; the
 *  Zones tab toggles only its VISIBILITY, because the row is the sole portrait
 *  mount of the pile components that own the blocking choice surfaces.
 *  Nothing on this overlay may sit in the bar's band any more.
 *
 *  Every chip opens the EXISTING reveal / stack view (the pile components in
 *  controlled-open mode, the stack panel toggled) — nothing is rebuilt. Mounted
 *  only on the portrait branch; landscape/desktop keep {@link BoardPiles}.
 *  View layer only. */
export default function BoardPortraitChips({
    orderedPlayers,
    stackItems,
}: BoardPortraitChipsProps) {
    const [opponent] = orderedPlayers;
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

            {/* The midline is the shared band boundary (#1760), which sits
                half the bottom bar's clearance above the viewport centre — not
                a literal `top-1/2`, or the chip would drift into the viewer's
                battlefield. */}
            <div
                className={`absolute right-2 ${PORTRAIT_MIDLINE_TOP} z-30 -translate-y-1/2`}
                data-testid="stack-chip-row"
            >
                <StackChip
                    count={stackItems.length}
                    open={stackOpen}
                    onToggle={() => setStackOpen((v) => !v)}
                />
            </div>

            {/* The stack overlay is the EXISTING panel, toggled by the chip
                instead of being always-on. */}
            {stackOpen && stackItems.length > 0 && (
                <GameStack stack={stackItems} />
            )}
        </>
    );
}
