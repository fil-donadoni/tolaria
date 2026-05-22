import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useUserDecks, useUserDeckMutations } from "~/hooks/useUserDecks";
import {
    deckPayload,
    toPresetLobbyDeck,
    type LobbyDeck,
} from "~/lib/deckTypes";
import {
    clearDeckPresetId,
    getStoredDeckPresetId,
    storeDeckPresetId,
    storeSession,
} from "~/lib/session";
import DashboardTopBar from "./dashboard-top-bar";
import DashboardPlayBox from "./dashboard-play-box";
import DeckList from "./deck-list";

function Lobby() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const [storedPresetId, setStoredPresetId] = useState<string | null>(() =>
        getStoredDeckPresetId()
    );
    const userDecks = useUserDecks();
    const { remove: removeUserDeck } = useUserDeckMutations();

    const pageVisible = usePageVisible();
    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const createGame = useMutation(api.game.createGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const joinGame = useMutation(api.game.joinGame);
    const openGames = useQuery(
        api.game.listOpenGames,
        pageVisible ? {} : "skip"
    );

    const presetLobbyDecks = useMemo<LobbyDeck[]>(
        () => (presetDecks ?? []).map(toPresetLobbyDeck),
        [presetDecks]
    );
    const userLobbyDecks = useMemo<LobbyDeck[]>(
        () => userDecks ?? [],
        [userDecks]
    );

    const allDecks = useMemo<LobbyDeck[]>(
        () => [...userLobbyDecks, ...presetLobbyDecks],
        [userLobbyDecks, presetLobbyDecks]
    );

    const selectedDeck = useMemo(
        () => allDecks.find((d) => d.presetId === storedPresetId) ?? null,
        [allDecks, storedPresetId]
    );

    useEffect(() => {
        if (
            presetDecks &&
            userDecks !== undefined &&
            storedPresetId &&
            !selectedDeck
        ) {
            clearDeckPresetId();
        }
    }, [presetDecks, userDecks, storedPresetId, selectedDeck]);

    const handleCreate = async () => {
        if (!selectedDeck || !user) return;
        const id = await createGame({
            name: `${user.nickname}'s game`,
            deck: deckPayload(selectedDeck),
        });
        storeSession(id, user._id);
        void navigate({ to: "/game" });
    };

    const handleCreateSolo = async () => {
        if (!selectedDeck || !user) return;
        const id = await createSoloGame({
            name: `${user.nickname}'s solo game`,
            deck: deckPayload(selectedDeck),
        });
        storeSession(id, `${user._id}-p1`);
        void navigate({ to: "/game" });
    };

    const handleJoin = async (targetGameId: Id<"games">) => {
        if (!selectedDeck || !user) return;
        await joinGame({
            gameId: targetGameId,
            deck: deckPayload(selectedDeck),
        });
        storeSession(targetGameId, user._id);
        void navigate({ to: "/game" });
    };

    const handleFocusDeck = (presetId: string) => {
        void navigate({ to: "/decks/$slug", params: { slug: presetId } });
    };

    const handleSelectDeck = (presetId: string) => {
        storeDeckPresetId(presetId);
        setStoredPresetId(presetId);
    };

    const handleChangeDeck = () => {
        setStoredPresetId(null);
        clearDeckPresetId();
    };

    const handleEditDeck = (presetId: string) => {
        void navigate({
            to: "/decks/$slug/edit",
            params: { slug: presetId },
        });
    };

    const handleDeleteDeck = async (presetId: string) => {
        const deck = userLobbyDecks.find((d) => d.presetId === presetId);
        if (!deck || deck.kind !== "user") return;
        if (!window.confirm(`Delete "${deck.name}"?`)) return;
        await removeUserDeck({ id: deck.userDeckId });
        if (storedPresetId === presetId) {
            setStoredPresetId(null);
            clearDeckPresetId();
        }
    };

    const handleNewDeck = () => {
        void navigate({ to: "/decks/create" });
    };

    if (
        presetDecks === undefined ||
        userDecks === undefined ||
        user === undefined
    ) {
        return (
            <div className="flex h-screen items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const renderUserActions = (deck: LobbyDeck) => (
        <>
            <button
                onClick={() => handleEditDeck(deck.presetId)}
                className="rounded border border-white/20 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                title="Edit deck"
            >
                Edit
            </button>
            <button
                onClick={() => void handleDeleteDeck(deck.presetId)}
                className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/20"
                title="Delete deck"
            >
                Delete
            </button>
        </>
    );

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
            <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
                <DashboardTopBar />

                <div className="flex items-baseline justify-between">
                    <h1 className="text-3xl font-bold tracking-tight">
                        Tolaria
                    </h1>
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">
                        Dashboard
                    </span>
                </div>

                <DashboardPlayBox
                    selectedDeck={selectedDeck}
                    openGames={openGames}
                    onCreateSolo={handleCreateSolo}
                    onCreateMultiplayer={handleCreate}
                    onJoin={handleJoin}
                    onChangeDeck={handleChangeDeck}
                />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6">
                        <DeckList
                            title="My Decks"
                            decks={userLobbyDecks}
                            selectedPresetId={storedPresetId}
                            onFocus={handleFocusDeck}
                            onSelect={handleSelectDeck}
                            emptyLabel="No saved decks yet. Create one to start building."
                            renderActions={renderUserActions}
                            headerExtra={
                                <button
                                    onClick={handleNewDeck}
                                    className="rounded bg-emerald-500/80 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
                                >
                                    + New Deck
                                </button>
                            }
                        />
                    </section>

                    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6">
                        <DeckList
                            title="Preset Decks"
                            decks={presetLobbyDecks}
                            selectedPresetId={storedPresetId}
                            onFocus={handleFocusDeck}
                            onSelect={handleSelectDeck}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
}

export default Lobby;
