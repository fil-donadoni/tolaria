import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { useViewportMode } from "~/hooks/useViewportMode";
import { PORTRAIT_VIEWER_NAMEPLATE_BOTTOM } from "~/lib/portrait-board-bands";
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
 *  Portrait mirrors the two nameplates top/bottom (#1814): the opponent stays
 *  top-center (`top-1`, unchanged since #1759/#1760), and the viewer's
 *  nameplate anchors bottom-center at {@link PORTRAIT_VIEWER_NAMEPLATE_BOTTOM}
 *  — the SAME `play-area-center-x -translate-x-1/2` horizontal centering as
 *  the opponent, just flipped to the bottom edge. That constant is the top
 *  edge of the viewer's hand band (= the battlefield's own bottom inset), not
 *  the bar's measured clearance directly: the portrait hand
 *  (`BoardHandPortrait`) bottom-aligns its cards to the bar-side edge of that
 *  band for thumb reach (#1759), so anchoring at the bar clearance itself
 *  would drop the nameplate straight onto the interactive hand fan. Anchoring
 *  at the band's OTHER edge instead sits it in the battlefield's own
 *  territory, clear of the fan by construction and still fully derived from
 *  the bar's measured height — no hardcoded pixel offset. This superseded an
 *  earlier iteration (#1759/#1760) that parked the viewer's nameplate at the
 *  shared portrait midline, left-aligned, purely to get it off the bottom
 *  edge the bar used to bury it under; this revision restores the
 *  symmetric top/bottom placement now that the hand-band boundary gives it
 *  a collision-free bottom anchor. Own life stays permanently visible on the
 *  bar's "You" tab too, which is also the self-target surface; the nameplate
 *  keeps carrying the arrow anchor and the mana pool. Desktop is unchanged.
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
    if (isPortrait)
        return `play-area-center-x -translate-x-1/2 ${PORTRAIT_VIEWER_NAMEPLATE_BOTTOM} mb-1`;
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
