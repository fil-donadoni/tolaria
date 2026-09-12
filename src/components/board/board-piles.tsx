import type { Player } from "~/types/game";
import {
    LANDSCAPE_OPPONENT_PILES_ANCHOR,
    LANDSCAPE_VIEWER_PILES_ANCHOR,
    landscapePileVars,
} from "~/lib/landscape-board-bands";
import PlayerGraveyard from "./player-graveyard";
import PlayerLibrary from "./player-library";
import PlayerExile from "./player-exile";
import PlayerCompanion from "./player-companion";
import PlayerEmblems from "./player-emblems";
import PlayerMonarchTile from "./player-monarch-tile";
import PlayerCityBlessingTile from "./player-city-blessing-tile";

type BoardPilesProps = {
    /** Opponent first, viewer second (same ordering as the rest of Board). */
    orderedPlayers: Player[];
    /** Landscape-compact (#1768): dock the piles as a ONE-tile-wide COLUMN
     *  beside the control strip, at the compact tile size. The desktop row of
     *  three full `--card-w-sm` tiles costs three card widths of board on a
     *  viewport that has none to spare, and `right-3` would park it under the
     *  strip. Everything else — which tiles, which dialogs — is unchanged. */
    compact?: boolean;
};

/** Card piles (graveyard / library / exile) on the spatial board (PRD #249,
 *  slice #255). Rather than reinvent the pile UI, this reuses the existing
 *  {@link PlayerGraveyard} / {@link PlayerLibrary} / {@link PlayerExile}
 *  components — each wraps `CardsPile`, so the collapsed stack AND the expanded
 *  reveal dialog (with inertial scroll, search-library picker, library context
 *  menu) come along unchanged. They keep emitting their
 *  `data-arrow-anchor-{graveyard,exile}` anchors for target arrows.
 *
 *  The classic board lays these out in a flex row inside `PlayerSideRow`; here
 *  they are absolutely positioned in the board corners so the battlefield/hand
 *  spatial zones keep the full width: the viewer's piles sit at the
 *  bottom-right edge, the opponent's mirror to the top-RIGHT (#334), so the
 *  right edge reads as one symmetric control column — opponent piles · stack ·
 *  pod · viewer piles — with both halves symmetric about the midline. View-layer
 *  only — the GRE boundary is untouched.
 *
 *  `items-start`: every tile in the row sizes itself as one card (`--card-w-sm`
 *  wide, `aspect-5/7` tall). Flex's default `stretch` overrides an item's
 *  aspect-derived height with the ROW's height, so one taller tile silently
 *  re-shaped every other one — and since the art is `object-cover`, re-shaping
 *  crops it (the companion card rendered squashed and cropped next to a fanned
 *  emblem stack, whose wider slot made the row taller). Pinning the cross-axis
 *  start keeps each tile's own aspect ratio authoritative. */
export default function BoardPiles({
    orderedPlayers,
    compact = false,
}: BoardPilesProps) {
    const [opponent, me] = orderedPlayers;
    // Compact re-points `--card-w-sm` for the whole rail, so every tile
    // (graveyard / library / exile / companion / emblems / designations) shrinks
    // together and keeps the SAME 5:7 box — including the empty-zone
    // placeholder, which is built from the identical `PILE_TILE_BOX`.
    const railStyle = compact ? landscapePileVars() : undefined;
    const opponentRail = compact
        ? LANDSCAPE_OPPONENT_PILES_ANCHOR
        : "absolute right-3 top-3 z-30 flex flex-row-reverse items-start gap-2";
    const viewerRail = compact
        ? LANDSCAPE_VIEWER_PILES_ANCHOR
        : "absolute right-3 bottom-3 z-30 flex flex-row-reverse items-start gap-2";

    return (
        <>
            {opponent && (
                <div
                    className={opponentRail}
                    style={railStyle}
                    // Only the COMPACT rail scrolls (`overflow-y-auto` on the
                    // landscape anchors above), and a scroll port whose content
                    // holds no focusable child is unreachable by keyboard —
                    // axe reds it `serious` (`scrollable-region-focusable`,
                    // measured at 844x390x3, issue #3492). The desktop row does
                    // not scroll, so it takes no tab stop it would not use.
                    // `role="region"` + a name, not a bare `tabIndex`: the same
                    // shape the deck builder's source pane already uses for
                    // this rule (`budgets.json`, `deck-builder`), and it is
                    // what keeps the new tab stop from landing a keyboard user
                    // on an unlabelled block (PR #3501 review).
                    {...(compact
                        ? {
                              tabIndex: 0,
                              role: "region",
                              "aria-label": "Opponent piles",
                          }
                        : {})}
                    data-testid="piles-opponent"
                    // The compact landscape rail is `overflow-y-auto`, and the
                    // opponent's tiles are a browse affordance that can be
                    // entirely non-interactive (empty zones render a
                    // placeholder, not a button) — a scroll region with no
                    // focusable descendant needs its own tab stop (axe
                    // `scrollable-region-focusable`, WCAG 2.1.1). The
                    // full-size rail does not scroll and must not gain one.
                    tabIndex={compact ? 0 : undefined}
                    role={compact ? "group" : undefined}
                    aria-label={compact ? "Opponent zones" : undefined}
                >
                    <PlayerGraveyard player={opponent} />
                    <PlayerLibrary player={opponent} />
                    <PlayerExile player={opponent} />
                    <PlayerCompanion player={opponent} />
                    <PlayerEmblems player={opponent} />
                    <PlayerMonarchTile player={opponent} />
                    <PlayerCityBlessingTile player={opponent} />
                </div>
            )}

            {me && (
                <div
                    className={viewerRail}
                    style={railStyle}
                    // See the opponent rail above — same scroll port, same
                    // rule, and a name of its own so the two regions stay
                    // distinguishable to a screen reader.
                    {...(compact
                        ? {
                              tabIndex: 0,
                              role: "region",
                              "aria-label": "Your piles",
                          }
                        : {})}
                    data-testid="piles-player"
                    // Same scroll region, viewer side — see the opponent rail.
                    tabIndex={compact ? 0 : undefined}
                    role={compact ? "group" : undefined}
                    aria-label={compact ? "Your zones" : undefined}
                >
                    <PlayerGraveyard player={me} />
                    <PlayerLibrary player={me} />
                    <PlayerExile player={me} />
                    <PlayerCompanion player={me} />
                    <PlayerEmblems player={me} />
                    <PlayerMonarchTile player={me} />
                    <PlayerCityBlessingTile player={me} />
                </div>
            )}
        </>
    );
}
