type BoardNextPlayerAnchorProps = {
    playerId: string;
    /** Anchor on the top edge (opponent) vs the bottom edge (viewer). */
    side: "top" | "bottom";
};

/** Target-arrow anchor for a player on the spatial board (PRD #249, slice
 *  #256). Carries `data-arrow-anchor-player` so a spell/ability that targets a
 *  player (e.g. Lightning Bolt to the face) can attach its arrow
 *  (`target-arrows-overlay.tsx`). Mirrors the anchor the classic board exposes
 *  on the life total (`player-life.tsx`); here it is a dedicated edge anchor
 *  because the spatial board does not yet mount the life-total chrome. Purely a
 *  geometry handle — non-interactive and visually inert. */
export default function BoardNextPlayerAnchor({
    playerId,
    side,
}: BoardNextPlayerAnchorProps) {
    return (
        <div
            data-arrow-anchor-player={playerId}
            aria-hidden
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 h-1 w-24 ${
                side === "top" ? "top-0" : "bottom-0"
            }`}
        />
    );
}
