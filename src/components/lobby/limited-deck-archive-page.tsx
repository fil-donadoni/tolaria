import { useMemo } from "react";
import EmptyState from "~/components/ui/empty-state";
import LoadingScreen from "~/components/ui/loading-screen";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import { useUserDecks } from "~/hooks/useUserDecks";
import { limitedDeckArchiveGroups } from "~/lib/limitedDeckArchive";
import LimitedDeckArchiveGroup from "./limited-deck-archive-group";

/** `/limited/decks` (PRD #8407, issue #8409): every Limited deck the player
 *  owns, by Limited Origin. Reads the live deck list and nothing else, so it
 *  has no state of its own to go stale. */
export default function LimitedDeckArchivePage() {
    const decks = useUserDecks();
    const groups = useMemo(
        () =>
            decks === undefined ? undefined : limitedDeckArchiveGroups(decks),
        [decks]
    );

    if (groups === undefined) return <LoadingScreen />;

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
            <SurfaceReadyMarker />
            <h1 className="font-display text-2xl text-parchment">
                Limited Deck Archive
            </h1>
            {groups.length === 0 ? (
                <EmptyState
                    message="No Limited decks yet. A deck you build at a Limited event is listed here."
                    className="rounded-sm border border-dashed border-border-subtle/30 px-4 py-3 text-xs text-text-disabled"
                />
            ) : (
                groups.map((group) => (
                    <LimitedDeckArchiveGroup
                        key={group.origin ?? "unclassified"}
                        group={group}
                    />
                ))
            )}
        </div>
    );
}
