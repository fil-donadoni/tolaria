// Mounts the viewer's graveyard reveal holding ONE card — the render step the
// graveyard cast-affordance suites share (issue #4491). The reveal is open so
// the per-card actions mount; the player is `"me"`, active with priority.
import type { CardInstance } from "~/types/game";
import PlayerGraveyard from "~/components/board/player-graveyard";
import { makeTestPlayer, renderWithBoardContext } from "./board-context";

/** `"me"`'s graveyard holding exactly `card`, as the graveyard view builds it. */
export function makeGraveyardPlayer(card: CardInstance) {
    return makeTestPlayer({
        name: "Me",
        library: { count: 0 },
        graveyard: [card],
    });
}

/** Renders `"me"`'s open graveyard holding `card`, seen by `viewerId`. */
export function renderGraveyardCard(card: CardInstance, viewerId: string) {
    const player = makeGraveyardPlayer(card);
    return renderWithBoardContext(
        <PlayerGraveyard player={player} open onOpenChange={() => {}} />,
        {
            ctx: {
                playerId: viewerId,
                allPlayers: [player],
                onSwitchGame: () => {},
            },
        }
    );
}
