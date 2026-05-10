import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import DeckDetail from "~/components/lobby/deck-detail";
import { usePageVisible } from "~/hooks/usePageVisible";
import { findDeckBySlug } from "~/lib/deckLookup";
import { getStoredDeckPresetId, storeDeckPresetId } from "~/lib/session";
import { listUserDecks } from "~/lib/userDecks";

export default function DeckDetailRoute() {
    const { slug } = useParams({ from: "/decks/$slug" });
    const navigate = useNavigate();
    const pageVisible = usePageVisible();

    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const userDecks = useMemo(() => listUserDecks(), []);
    const selectedPresetId = getStoredDeckPresetId();

    const deck = useMemo(
        () => findDeckBySlug(slug, presetDecks, userDecks),
        [slug, presetDecks, userDecks]
    );

    useEffect(() => {
        if (presetDecks === undefined) return;
        if (deck === null) {
            void navigate({ to: "/", replace: true });
        }
    }, [deck, presetDecks, navigate]);

    if (presetDecks === undefined) {
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
