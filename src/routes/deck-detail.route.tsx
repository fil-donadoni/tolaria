import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import DeckDetail from "~/components/lobby/deck-detail";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useUserDecks, useUserDeckMutations } from "~/hooks/useUserDecks";
import { canEditPresets } from "~/lib/adminGating";
import { findDeckBySlug } from "~/lib/deckLookup";
import { toPresetLobbyDeck, type LobbyDeck } from "~/lib/deckTypes";
import {
    clearDeckPresetId,
    getStoredDeckPresetId,
    storeDeckPresetId,
    storePlayMode,
} from "~/lib/session";

export default function DeckDetailRoute() {
    const { slug } = useParams({ from: "/decks/$slug" });
    const navigate = useNavigate();
    const pageVisible = usePageVisible();

    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const userDecks = useUserDecks();
    const { remove } = useUserDeckMutations();
    const selectedPresetId = getStoredDeckPresetId();
    const user = useCurrentUser();
    const isAdmin = canEditPresets(user);

    const allDecks = useMemo<LobbyDeck[]>(() => {
        const presets = (presetDecks ?? []).map((d) => toPresetLobbyDeck(d));
        return [...(userDecks ?? []), ...presets];
    }, [presetDecks, userDecks]);

    const deck = useMemo(
        () => findDeckBySlug(slug, allDecks),
        [slug, allDecks]
    );

    // Above the early returns: the hook must run on every render, and the deck
    // name only exists once both deck queries have landed.
    useDocumentTitle(deck?.name ?? "Deck");

    useEffect(() => {
        if (presetDecks === undefined || userDecks === undefined) return;
        if (deck === null) {
            void navigate({ to: "/", replace: true });
        }
    }, [deck, presetDecks, userDecks, navigate]);

    if (presetDecks === undefined || userDecks === undefined) {
        return (
            <div className="flex min-h-full items-center justify-center text-text">
                Loading...
            </div>
        );
    }

    if (!deck) return null;

    const handleDelete =
        deck.kind === "user"
            ? () => {
                  if (selectedPresetId === deck.presetId) clearDeckPresetId();
                  void remove({ id: deck.userDeckId }).then(() =>
                      navigate({ to: "/" })
                  );
              }
            : undefined;

    // Edit routes to the same two destinations the "My Decks"/"Preset Decks"
    // panels use (`lobby.tsx`'s `handleEditDeck`/`handleEditPreset`, issue
    // #2591): a user deck always edits; a preset edits only for an admin —
    // the server re-gates via `assertIsAdmin` regardless, this is cosmetic.
    const handleEdit =
        deck.kind === "user"
            ? () =>
                  void navigate({
                      to: "/decks/$slug/edit",
                      params: { slug: deck.presetId },
                  })
            : isAdmin
              ? () =>
                    void navigate({
                        to: "/presets/$slug/edit",
                        params: { slug: deck.presetId },
                    })
              : undefined;

    return (
        <DeckDetail
            deck={deck}
            isSelected={selectedPresetId === deck.presetId}
            onBack={() => void navigate({ to: "/" })}
            onSelect={() => {
                storeDeckPresetId(deck.presetId);
                // Reconcile the lobby's game-mode selector to match THIS
                // deck (issue #2591 review, L6): the lobby's own toggle
                // clears a mismatched selection on mode change
                // (`handlePlayModeChange`), but arriving here from
                // `/decks/$slug` bypasses that — without this, selecting a
                // Manual Deck while the stored mode is Arena (or vice versa)
                // lands back on a lobby where the deck is filtered out of
                // every list and every Play action is disabled.
                storePlayMode(
                    deck.format === "manual" ? "cockatrice" : "arena"
                );
                void navigate({ to: "/" });
            }}
            onDelete={handleDelete}
            onEdit={handleEdit}
        />
    );
}
