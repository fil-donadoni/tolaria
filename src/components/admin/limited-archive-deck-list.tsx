// One origin's decks, paginated: the server caps a page (legality costs reads
// per deck), so the list grows by "Load more" instead of reading the origin
// whole. `origin: null` reads the unclassified group.
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import LimitedArchiveDeckRow from "./limited-archive-deck-row";
import { originGroupLabel } from "@/lib/limitedArchiveLabels";

const PAGE_SIZE = 25;

export default function LimitedArchiveDeckList({
    origin,
    selectedDeckId,
    onSelect,
}: {
    origin: string | null;
    selectedDeckId: Id<"userDecks"> | null;
    onSelect: (deckId: Id<"userDecks">) => void;
}) {
    const { results, status, loadMore } = usePaginatedQuery(
        api.userDecks.listLimitedOriginDecksAdmin,
        { origin },
        { initialNumItems: PAGE_SIZE }
    );

    return (
        <Panel>
            <PanelHeader
                title={originGroupLabel(origin)}
                subtitle={
                    status === "LoadingFirstPage"
                        ? "Loading…"
                        : `${results.length} loaded`
                }
            />
            <PanelBody className="flex flex-col gap-1">
                {status === "LoadingFirstPage" ? (
                    <span className="text-xs text-text-disabled">Loading…</span>
                ) : results.length === 0 ? (
                    <span className="text-xs text-text-disabled">
                        No decks in this group
                    </span>
                ) : (
                    results.map((deck) => (
                        <LimitedArchiveDeckRow
                            key={deck._id}
                            deck={deck}
                            selected={deck._id === selectedDeckId}
                            onSelect={() => onSelect(deck._id)}
                        />
                    ))
                )}
                {status === "CanLoadMore" && (
                    <Button
                        variant="secondary"
                        onClick={() => loadMore(PAGE_SIZE)}
                    >
                        Load more
                    </Button>
                )}
            </PanelBody>
        </Panel>
    );
}
