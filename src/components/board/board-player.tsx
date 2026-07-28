import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { useViewportMode } from "~/hooks/useViewportMode";
import { PORTRAIT_MIDLINE_TOP } from "~/lib/portrait-board-bands";
import {
    LANDSCAPE_OPPONENT_SEAT_ANCHOR,
    LANDSCAPE_VIEWER_SEAT_ANCHOR,
} from "~/lib/landscape-board-bands";
import PlayerNameplate from "./player-nameplate";
import PlayerManaPool from "./player-mana-pool";

type BoardPlayerProps = {
    player: Player;
    /** Anchor on the top edge (opponent) vs the bottom edge (viewer). */
    side: "top" | "bottom";
};

/** Where this seat's chrome anchors on the board.
 *
 *  Portrait moves the VIEWER's nameplate off the bottom edge: the variant-D
 *  bottom bar (#1759) owns that edge and used to bury the nameplate underneath
 *  it — life unreadable, self-target untappable (#1758 audit). It relocates to
 *  the left of the midline, i.e. the top-left corner of the viewer's own half,
 *  mirroring how the opponent's portrait pile chips sit at the top-left of
 *  theirs. Own life stays permanently visible on the bar's "You" tab, which is
 *  also the self-target surface; the nameplate keeps carrying the arrow anchor
 *  and the mana pool. Landscape/desktop are unchanged.
 *
 *  "Midline" is the SHARED portrait band boundary ({@link PORTRAIT_MIDLINE_TOP},
 *  #1760), not the geometric half of the viewport: the boundary sits half the
 *  bottom bar's clearance above centre so both battlefields get equal height.
 *  Anchoring to a literal `top-1/2` would drop the nameplate inside the
 *  viewer's creature row instead of on its top edge.
 *
 *  Landscape-compact (#1768) moves BOTH seats' chrome into the board's left
 *  rail, stacked around the landscape midline. On a phone held sideways the
 *  desktop anchors (`play-area-center-x` at the top/bottom edge) land squarely
 *  on the hand strips — the audit's "nameplates overlap cards". The rail is
 *  subtracted from every band by the landscape budget, so chrome placed in it
 *  cannot overlap a card at any hand size. */
function seatAnchorClass(
    side: "top" | "bottom",
    isPortrait: boolean,
    landscapeCompact: boolean
): string {
    if (landscapeCompact)
        return side === "top"
            ? LANDSCAPE_OPPONENT_SEAT_ANCHOR
            : LANDSCAPE_VIEWER_SEAT_ANCHOR;
    if (side === "top") return "play-area-center-x -translate-x-1/2 top-1";
    if (isPortrait) return `left-2 ${PORTRAIT_MIDLINE_TOP} mt-1`;
    return "play-area-center-x -translate-x-1/2 bottom-1";
}

/** Player-facing chrome for the spatial board (PRD #249, slice #280),
 *  replacing the previously inert player-edge geometry handle. Mounts the
 *  shared {@link PlayerNameplate} (life total + name + priority ring +
 *  targeting / damage-choice ring) positioned at the player's board edge, wired
 *  to the shared {@link usePlayerInteraction} controller so a click dispatches
 *  the SAME `selectTarget` / choice-buffer toggle as the classic
 *  `player-life.tsx`.
 *
 *  The nameplate carries `data-arrow-anchor-player`, so it doubles as the
 *  target-arrow anchor the inert handle used to provide — there is exactly one
 *  anchor element per player, which the arrow publisher
 *  ({@link useDomAnchorPublisher}) measures. */
export default function BoardPlayer({ player, side }: BoardPlayerProps) {
    const interaction = usePlayerInteraction(player);
    const isPortrait = useIsPortrait();
    const landscapeCompact = useViewportMode() === "landscape-compact";
    // Relative wrapper so the floating mana-pool indicator anchors to the
    // nameplate (its absolute `bottom-full` / `top-full` need a positioned
    // ancestor), mirroring how the classic `player-side-row` pairs the pool with
    // the life cell. Without it the pool — restored here — has nothing to hang
    // off and would be clipped to the viewport edge.
    return (
        <div
            className={`absolute z-10 ${seatAnchorClass(
                side,
                isPortrait,
                landscapeCompact
            )}`}
        >
            <PlayerManaPool player={player} />
            <PlayerNameplate player={player} interaction={interaction} />
        </div>
    );
}
