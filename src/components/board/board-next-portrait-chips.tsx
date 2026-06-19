import { useState } from "react";
import type { Player, StackItem } from "~/types/game";
import BoardNextPileChips from "./board-next-pile-chips";
import StackChip from "./stack-chip";
import GameStack from "./game-stack";

type BoardNextPortraitChipsProps = {
    /** Opponent first, viewer second (same ordering as the rest of BoardNext). */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Portrait chip overlay (#336) — the phone replacement for the desktop
 *  right-edge control column. The space-eating pile columns and the always-on
 *  floating stack panel are gone; instead:
 *
 *  - opponent's graveyard / library / exile collapse to a chip row pinned
 *    top-left (clear of the opponent life pill on the top-right),
 *  - the viewer's pile chips + a stack chip sit just above the bottom action
 *    bar,
 *  - the stack chip toggles the EXISTING {@link GameStack} overlay.
 *
 *  Every chip opens the EXISTING reveal / stack view (the pile components in
 *  controlled-open mode, the stack panel toggled) — nothing is rebuilt. Mounted
 *  only on the portrait branch; landscape/desktop keep {@link BoardNextPiles}.
 *  View layer only. */
export default function BoardNextPortraitChips({
    orderedPlayers,
    stackItems,
}: BoardNextPortraitChipsProps) {
    const [opponent, me] = orderedPlayers;
    const [stackOpen, setStackOpen] = useState(false);

    return (
        <>
            {opponent && (
                <div
                    className="absolute left-2 top-2 z-30"
                    data-testid="pile-chips-row-opponent"
                >
                    <BoardNextPileChips player={opponent} />
                </div>
            )}

            <div
                className="absolute inset-x-2 bottom-24 z-30 flex items-center justify-end gap-1"
                data-testid="pile-chips-row-player"
            >
                <StackChip
                    count={stackItems.length}
                    open={stackOpen}
                    onToggle={() => setStackOpen((v) => !v)}
                />
                {me && <BoardNextPileChips player={me} />}
            </div>

            {/* The stack overlay is the EXISTING panel, toggled by the chip
                instead of being always-on. */}
            {stackOpen && stackItems.length > 0 && (
                <GameStack stack={stackItems} />
            )}
        </>
    );
}
