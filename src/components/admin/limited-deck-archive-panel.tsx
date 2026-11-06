// `/admin/limited-decks` — the global, read-only Limited Deck Archive (PRD
// #8407, issue #8410): every Limited Origin that holds decks with its count
// (the unclassified group included), one origin's decks with their owners,
// and a deck's full list. Three state-driven columns, same shape as
// `BugReportsAdminPanel`.
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import SurfaceReadyMarker from "@/components/ui/surface-ready-marker";
import LimitedArchiveOriginRow from "./limited-archive-origin-row";
import LimitedArchiveDeckList from "./limited-archive-deck-list";
import LimitedArchiveDeckDetail from "./limited-archive-deck-detail";

export default function LimitedDeckArchivePanel() {
    const origins = useQuery(api.userDecks.listLimitedOriginsAdmin, {});
    const [selectedOrigin, setSelectedOrigin] = useState<
        string | null | undefined
    >(undefined);
    const [selectedDeckId, setSelectedDeckId] =
        useState<Id<"userDecks"> | null>(null);

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {origins !== undefined && <SurfaceReadyMarker />}
            <Panel>
                <PanelHeader
                    title="Origins"
                    subtitle={
                        origins === undefined
                            ? "Loading…"
                            : `${origins.length} groups`
                    }
                />
                <PanelBody className="flex flex-col gap-1">
                    {origins === undefined ? (
                        <span className="text-xs text-text-disabled">
                            Loading…
                        </span>
                    ) : origins.length === 0 ? (
                        <span className="text-xs text-text-disabled">
                            No Limited decks saved yet
                        </span>
                    ) : (
                        origins.map((row) => (
                            <LimitedArchiveOriginRow
                                key={row.origin ?? "unclassified"}
                                origin={row.origin}
                                deckCount={row.deckCount}
                                selected={row.origin === selectedOrigin}
                                onSelect={() => {
                                    setSelectedOrigin(row.origin);
                                    setSelectedDeckId(null);
                                }}
                            />
                        ))
                    )}
                </PanelBody>
            </Panel>

            {selectedOrigin === undefined ? (
                <Panel>
                    <PanelBody>
                        <span className="text-sm text-text-muted">
                            Select an origin to see its decks.
                        </span>
                    </PanelBody>
                </Panel>
            ) : (
                <LimitedArchiveDeckList
                    key={selectedOrigin ?? "unclassified"}
                    origin={selectedOrigin}
                    selectedDeckId={selectedDeckId}
                    onSelect={setSelectedDeckId}
                />
            )}

            {selectedDeckId ? (
                <LimitedArchiveDeckDetail deckId={selectedDeckId} />
            ) : (
                <Panel>
                    <PanelBody>
                        <span className="text-sm text-text-muted">
                            Select a deck to read its full list.
                        </span>
                    </PanelBody>
                </Panel>
            )}
        </div>
    );
}
