import type { Player } from "~/types/game";
import type { StackItem } from "~/types/game";
import PlayerBoard from "./player-board";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import PriorityIndicator from "./priority-indicator";
import TargetArrowsOverlay from "./target-arrows-overlay";

type BoardClassicProps = {
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Current spatial board (PRD #249). The two player halves stacked
 *  vertically, the stack, the priority/phase chrome, and the target arrows.
 *  Extracted from `board.tsx` so the `board-variant` selector can swap it for
 *  `BoardNext` (issue #250) without touching the surrounding non-spatial
 *  chrome. */
export default function BoardClassic({
    orderedPlayers,
    stackItems,
}: BoardClassicProps) {
    return (
        <>
            {orderedPlayers.map((player) => (
                <PlayerBoard key={player.id} player={player} />
            ))}
            <PriorityIndicator />
            <PhaseTracker />
            {stackItems.length > 0 && <GameStack stack={stackItems} />}
            <TargetArrowsOverlay stack={stackItems} />
        </>
    );
}
