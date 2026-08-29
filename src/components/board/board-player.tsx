import type { Player } from "~/types/game";
import { usePlayerInteractionHook } from "~/hooks/usePlayerInteractionContext";
import { useGameContext } from "~/hooks/useGameContext";
import { isUnderAttack } from "~/lib/board-chrome-v4";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { useViewportMode } from "~/hooks/useViewportMode";
import { PORTRAIT_VIEWER_NAMEPLATE_BOTTOM } from "~/lib/portrait-board-bands";
import {
    LANDSCAPE_OPPONENT_SEAT_ANCHOR,
    LANDSCAPE_VIEWER_SEAT_ANCHOR,
} from "~/lib/landscape-board-bands";
import PlayerNameplate from "./player-nameplate";
import PlayerManaPool from "./player-mana-pool";
import PlayerGrantedAbilities from "./player-granted-abilities";

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
 *  edge of the viewer's hand band, not the bar's measured clearance directly:
 *  the portrait hand (`BoardHandPortrait`) bottom-aligns its cards to the
 *  bar-side edge of that band for thumb reach (#1759), so anchoring at the
 *  bar clearance itself would drop the nameplate straight onto the
 *  interactive hand fan. Anchoring at the band's OTHER edge instead keeps it
 *  clear of the fan by construction and still fully derived from the bar's
 *  measured height — no hardcoded pixel offset.
 *
 *  **Post-review fixup:** the nameplate grows UPWARD from that anchor and
 *  used to grow straight into the battlefield's own bottom inset — dead
 *  center, exactly where `splitRowLayout` centers the back row (lands) from
 *  turn 1. The battlefield's bottom inset (`PORTRAIT_VIEWER_BF_BOTTOM_VAR`,
 *  `portrait-board-bands.ts`) now reserves a whole extra band
 *  (`PORTRAIT_NAMEPLATE_BAND_H`) ABOVE the nameplate's anchor for exactly
 *  that growth — the same "rail" move `LANDSCAPE_SIDE_GUTTER` makes
 *  laterally for landscape-compact seat chrome — so the nameplate has its
 *  own collision-free territory rather than merely a usually-small overlap.
 *  This superseded an earlier iteration (#1759/#1760) that parked the
 *  viewer's nameplate at the shared portrait midline, left-aligned, purely to
 *  get it off the bottom edge the bar used to bury it under; this revision
 *  restores the symmetric top/bottom placement now that both the hand-band
 *  boundary AND the reserved nameplate band give it a collision-free bottom
 *  anchor. Own life stays permanently visible on the bar's "You" tab too,
 *  which is also the self-target surface; the nameplate keeps carrying the
 *  arrow anchor and the mana pool (the latter `pointer-events-none` — see
 *  `player-mana-pool.tsx`). Desktop is unchanged.
 *
 *  **Round-2 fixup:** the anchor no longer carries an `mb-1` margin between
 *  the nameplate and the hand band's top edge. That 4px gap used to be spent
 *  OUTSIDE `PORTRAIT_NAMEPLATE_BAND_H`'s own accounting — a real cost the
 *  reservation math silently didn't budget for (review round 2, finding 2).
 *  Dropping it removes the gap entirely rather than tracking it twice; the
 *  nameplate now sits flush on the hand band's own top edge, same as the
 *  opponent's `top-1` sits flush against the viewport edge.
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
        return `play-area-center-x -translate-x-1/2 ${PORTRAIT_VIEWER_NAMEPLATE_BOTTOM}`;
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
    // Read WHICH interaction hook to call (provider-supplied, else the real
    // `usePlayerInteraction`) and call it right here, unconditionally, exactly
    // where the direct call used to live — see
    // `usePlayerInteractionContext.ts` for why the hook itself, not its
    // result, is what's injected (issue #2169, mirroring #2166).
    const useInteraction = usePlayerInteractionHook();
    const interaction = useInteraction(player);
    const isPortrait = useIsPortrait();
    const landscapeCompact = useViewportMode() === "landscape-compact";
    // CR 506.2 — the `attacked` plaque state (ADR 0103, issue #2727). Derived
    // HERE rather than inside the presentational `PlayerNameplate`, which is
    // also rendered by the provider-free classic chrome (`player-life.tsx`):
    // this component already reads the game context for everything else.
    const { combat, activePlayerId } = useGameContext();
    const underAttack = isUnderAttack(combat, player.id, activePlayerId);
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
            {/* Player-level granted abilities (issue #2691). In NORMAL flow,
                before the nameplate: the wrapper pins its bottom edge for the
                viewer's seat, so the controls grow upward off the nameplate
                instead of overlapping it, and they inherit the wrapper's
                horizontal centering rather than the `absolute left-full` box
                the deleted `PlayerSideRow` used to give them. The mana pool
                floats off the wrapper's own `bottom-full`, so it rides above
                the controls automatically. Renders nothing for the opponent's
                seat, or when the viewer holds no grant.

                Mounted CONDITIONALLY on the seat actually holding a grant: the
                component subscribes to `activatePlayerAbility`, and every seat
                renders on every board frame, so an unconditional mount would
                make a Convex client a hard requirement of the seat chrome for
                the overwhelmingly common empty case (it is what broke
                `player-interaction-injection.test.tsx`, which renders this
                component with no provider). The component re-checks the same
                condition — this is the cheap outer gate, not the authority. */}
            {player.grantedAbilities?.length ? (
                <PlayerGrantedAbilities player={player} />
            ) : null}
            <PlayerNameplate
                player={player}
                interaction={interaction}
                // Issue #2589 — landscape-compact now gets the SAME one-row
                // compact nameplate portrait uses (previously only
                // `isPortrait`): the seat chrome lives in the narrowed
                // `LANDSCAPE_SIDE_GUTTER` left rail, and the full ~91px
                // multi-row box never fit that budget — it only "worked"
                // because the rail used to be wide enough to hide the
                // overflow, at the cost of the ≤25% width AC this issue
                // tightens the rail to satisfy.
                compact={isPortrait || landscapeCompact}
                // Round-3 review finding 1 — the compact box drops the name
                // span ONLY in landscape (its rail is width-capped; portrait
                // isn't), so the nameplate needs to know WHICH seam gave it
                // `compact`, not just that it did.
                landscapeCompact={landscapeCompact}
                underAttack={underAttack}
            />
        </div>
    );
}
