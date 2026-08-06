import type { CardInstance } from "~/types/game";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";

/** Play-lands-from-top-of-library affordance (CR 305.1-analog — an
 *  unconditional, player-wide permission granted by a battlefield source while
 *  it remains in play, e.g. Courser of Kruphix). Rendered over the LAND on top
 *  of the viewer's own library when the projection tagged it with
 *  `legalActions` (`isPlayableLibraryTopLand`, re-derived live from the
 *  battlefield every projection — the affordance disappears the instant the
 *  granting source leaves play, or a draw/shuffle moves a different card to the
 *  top). Routes through the SAME commit pipeline as a hand-land play
 *  ({@link useHandCardCommit}): `playCard` locates the card across
 *  hand/exile/graveyard/library-top by id and, for a library-top source,
 *  resolves it via `applyPlayLandFromLibraryTop` (moves library → battlefield,
 *  consumes the CR 305.2 land drop). Calls `onCommitted` after dispatch so the
 *  host can close the browse dialog.
 *
 *  Sibling of `graveyard-play-land-button.tsx`, deliberately a separate
 *  component rather than a shared one with a prop: the two live in different
 *  zone components, carry different disabled-state copy, and the one-component-
 *  per-file rule makes the duplication cheaper than the indirection. */
export default function LibraryPlayLandButton({
    card,
    onCommitted,
}: {
    card: CardInstance;
    onCommitted?: () => void;
}) {
    const { onPlayClick } = useHandCardCommit(card);

    // CR 305.2 — the projection attaches "play" only when a land drop remains
    // at sorcery timing (mirrors the hand/exile/graveyard play affordance).
    // Gate the button so an illegal play is disabled rather than dispatched and
    // rejected by `assertLegalAction`.
    const enabled = card.legalActions?.includes("play") ?? false;

    return (
        <button
            type="button"
            disabled={!enabled}
            title={
                enabled
                    ? undefined
                    : "Can't play yet — no land drop remaining, or not your main phase."
            }
            onClick={() => {
                if (!enabled) return;
                onPlayClick();
                onCommitted?.();
            }}
            className="absolute inset-x-0 bottom-0 z-30 rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-elevated/80 disabled:text-text-muted disabled:shadow-none"
        >
            Play
        </button>
    );
}
