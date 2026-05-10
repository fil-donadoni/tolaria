import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import DeckDetail from "~/components/lobby/deck-detail";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useUserDecks } from "~/hooks/useUserDecks";
import { findDeckBySlug } from "~/lib/deckLookup";
import { toPresetLobbyDeck, type LobbyDeck } from "~/lib/deckTypes";
import { getStoredDeckPresetId, storeDeckPresetId } from "~/lib/session";

export default function DeckDetailRoute() {
    const { slug } = useParams({ from: "/decks/$slug" });
    const navigate = useNavigate();
    const pageVisible = usePageVisible();

    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const userDecks = useUserDecks();
    const selectedPresetId = getStoredDeckPresetId();

    const allDecks = useMemo<LobbyDeck[]>(() => {
        const presets = (presetDecks ?? []).map(toPresetLobbyDeck);
        return [...(userDecks ?? []), ...presets];
    }, [presetDecks, userDecks]);

    const deck = useMemo(
        () => findDeckBySlug(slug, allDecks),
        [slug, allDecks]
    );

    useEffect(() => {
        if (presetDecks === undefined || userDecks === undefined) return;
        if (deck === null) {
            void navigate({ to: "/", replace: true });
        }
    }, [deck, presetDecks, userDecks, navigate]);

    if (presetDecks === undefined || userDecks === undefined) {
        return (
            <div className="flex h-screen items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    if (!deck) return null;

    return (
        <DeckDetail
            deck={deck}
            isSelected={selectedPresetId === deck.presetId}
            onBack={() => void navigate({ to: "/" })}
            onSelect={() => {
                storeDeckPresetId(deck.presetId);
                void navigate({ to: "/" });
            }}
        />
    );
}
