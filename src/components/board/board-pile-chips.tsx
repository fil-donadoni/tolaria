import { useState } from "react";
import type { Player } from "~/types/game";
import { libraryCount } from "~/lib/library-knowledge";
import PileChip from "./pile-chip";
import PlayerGraveyard from "./player-graveyard";
import PlayerLibrary from "./player-library";
import PlayerExile from "./player-exile";

/** Which zone's reveal dialog is open for this seat (single-open at a time). */
type OpenZone = "graveyard" | "library" | "exile" | null;

/** Portrait zone chips for one seat (#336). The desktop right-edge pile column
 *  eats horizontal space a phone can't spare, so on portrait the
 *  graveyard / library / exile piles collapse to a row of tappable
 *  {@link PileChip}s (zone label + count). Tapping a chip opens the EXISTING
 *  reveal dialog of the corresponding pile component in controlled-open mode —
 *  the pile renders only its dialog (collapsed card stack suppressed), so all
 *  its real behaviour (target clicks, draw / mill / search context menu,
 *  inertial-scroll fan / grid) is reused unchanged. View layer only. */
export default function BoardPileChips({ player }: { player: Player }) {
    const [openZone, setOpenZone] = useState<OpenZone>(null);
    const toggle = (zone: Exclude<OpenZone, null>) =>
        setOpenZone((cur) => (cur === zone ? null : zone));

    return (
        <div className="flex gap-1" data-testid={`pile-chips-${player.id}`}>
            <PileChip
                label="GY"
                count={player.graveyard.length}
                onClick={() => toggle("graveyard")}
                data-testid={`chip-graveyard-${player.id}`}
            />
            <PileChip
                label="LIB"
                count={libraryCount(player.library)}
                onClick={() => toggle("library")}
                data-testid={`chip-library-${player.id}`}
            />
            <PileChip
                label="EXL"
                count={player.exile.length}
                onClick={() => toggle("exile")}
                data-testid={`chip-exile-${player.id}`}
            />

            {/* Pile components in controlled-open mode: they render ONLY their
                reveal dialog (no collapsed visual), driven by the chips above. */}
            <div className="sr-only">
                <PlayerGraveyard
                    player={player}
                    open={openZone === "graveyard"}
                    onOpenChange={(o) => setOpenZone(o ? "graveyard" : null)}
                />
                <PlayerLibrary
                    player={player}
                    open={openZone === "library"}
                    onOpenChange={(o) => setOpenZone(o ? "library" : null)}
                />
                <PlayerExile
                    player={player}
                    open={openZone === "exile"}
                    onOpenChange={(o) => setOpenZone(o ? "exile" : null)}
                />
            </div>
        </div>
    );
}
