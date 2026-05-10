import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AccountMenu } from "~/components/auth/account-menu";
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

    const canPlay = !!selectedDeck && !!user;

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

    if (!selectedDeck) {
        return (
            <div className="flex min-h-screen flex-col items-center gap-6 px-6 py-12 text-white">
                <h1 className="text-2xl font-bold">Tolaria</h1>
                <div className="w-full max-w-xl">
                    <AccountMenu />
                </div>
                <p className="text-sm text-white/60">
                    Select a deck to continue.
                </p>
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
                            + Create New Deck
                        </button>
                    }
                />
                <DeckList
                    title="Built-in Decks"
                    decks={presetLobbyDecks}
                    selectedPresetId={storedPresetId}
                    onFocus={handleFocusDeck}
                    onSelect={handleSelectDeck}
                />
            </div>
        );
    }

    const selectedIsUserDeck = selectedDeck.kind === "user";

    return (
        <div className="flex min-h-screen flex-col items-center gap-6 px-6 py-12 text-white">
            <h1 className="text-2xl font-bold">Tolaria</h1>
            <div className="w-full max-w-xl">
                <AccountMenu />
            </div>

            <div className="flex items-center gap-3 rounded border border-white/10 bg-white/5 px-4 py-2 text-sm">
                <span className="text-white/60">Deck:</span>
                <span className="font-semibold">{selectedDeck.name}</span>
                {selectedIsUserDeck && (
                    <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                        Custom
                    </span>
                )}
                <button
                    onClick={() => handleFocusDeck(selectedDeck.presetId)}
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                >
                    View
                </button>
                {selectedIsUserDeck && (
                    <button
                        onClick={() => handleEditDeck(selectedDeck.presetId)}
                        className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                    >
                        Edit
                    </button>
                )}
                <button
                    onClick={handleChangeDeck}
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                >
                    Change Deck
                </button>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={handleCreate}
                    disabled={!canPlay}
                    className="rounded bg-white/10 px-6 py-3 text-lg hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Create Game
                </button>
                <button
                    onClick={handleCreateSolo}
                    disabled={!canPlay}
                    className="rounded border border-white/20 bg-transparent px-6 py-3 text-lg hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Single-user game: you control both players, the viewer follows whoever has priority."
                >
                    New Solo Game
                </button>
            </div>

            {openGames && openGames.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-white/50">Open games:</p>
                    {openGames.map((g) => (
                        <button
                            key={g._id}
                            onClick={() => handleJoin(g._id)}
                            disabled={!canPlay}
                            className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {g.name} ({g.players.length}/2)
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default Lobby;
