import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { DeckPreset } from "@convex/deckPresets";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    PLAYER_COLORS,
    clearDeckPresetId,
    getOrCreateClientId,
    getStoredDeckPresetId,
    getStoredPlayerName,
    storeDeckPresetId,
    storePlayerName,
    storeSession,
} from "~/lib/session";
import {
    type UserDeck,
    deleteUserDeck,
    isUserDeckId,
    listUserDecks,
} from "~/lib/userDecks";
import DeckList from "./deck-list";

function Lobby() {
    const navigate = useNavigate();
    const [playerName, setPlayerName] = useState(() => getStoredPlayerName());
    const [storedPresetId, setStoredPresetId] = useState<string | null>(() =>
        getStoredDeckPresetId()
    );
    const [userDecks, setUserDecks] = useState<UserDeck[]>(() =>
        listUserDecks()
    );
    const clientId = useMemo(() => getOrCreateClientId(), []);

    const pageVisible = usePageVisible();
    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const createGame = useMutation(api.game.createGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const joinGame = useMutation(api.game.joinGame);
    const allOpenGames = useQuery(
        api.game.listOpenGames,
        pageVisible ? {} : "skip"
    );
    const openGames = useMemo(
        () =>
            allOpenGames?.filter(
                (g) => !g.players.some((p) => p.id === clientId)
            ),
        [allOpenGames, clientId]
    );

    const allDecks = useMemo<DeckPreset[]>(
        () => [...userDecks, ...(presetDecks ?? [])],
        [userDecks, presetDecks]
    );

    const selectedDeck = useMemo(
        () => allDecks.find((d) => d.presetId === storedPresetId) ?? null,
        [allDecks, storedPresetId]
    );

    useEffect(() => {
        if (presetDecks && storedPresetId && !selectedDeck) {
            clearDeckPresetId();
        }
    }, [presetDecks, storedPresetId, selectedDeck]);

    const refreshUserDecks = useCallback(() => {
        setUserDecks(listUserDecks());
    }, []);

    const canPlay = !!selectedDeck && playerName.trim().length > 0;

    const deckPayload = (d: DeckPreset) => ({
        id: d.presetId,
        name: d.name,
        format: d.format,
        cards: d.cards,
    });

    const handleCreate = async () => {
        if (!selectedDeck) return;
        const name = playerName.trim() || "Player 1";
        const pid = getOrCreateClientId();
        const id = await createGame({
            name: `${name}'s game`,
            player: {
                id: pid,
                name,
                bgColor: PLAYER_COLORS[0],
                deck: deckPayload(selectedDeck),
            },
        });
        storePlayerName(name);
        storeSession(id, pid);
        void navigate({ to: "/game" });
    };

    const handleCreateSolo = async () => {
        if (!selectedDeck) return;
        const name = playerName.trim() || "Player";
        const baseId = getOrCreateClientId();
        const p1Id = `${baseId}-p1`;
        const p2Id = `${baseId}-p2`;
        const deck = deckPayload(selectedDeck);
        const id = await createSoloGame({
            name: `${name}'s solo game`,
            player1: {
                id: p1Id,
                name: `${name} (P1)`,
                bgColor: PLAYER_COLORS[0],
                deck,
            },
            player2: {
                id: p2Id,
                name: `${name} (P2)`,
                bgColor: PLAYER_COLORS[1],
                deck,
            },
        });
        storePlayerName(name);
        storeSession(id, p1Id);
        void navigate({ to: "/game" });
    };

    const handleJoin = async (targetGameId: Id<"games">) => {
        if (!selectedDeck) return;
        const name = playerName.trim() || "Player 2";
        const pid = getOrCreateClientId();
        await joinGame({
            gameId: targetGameId,
            player: {
                id: pid,
                name,
                bgColor: PLAYER_COLORS[1],
                deck: deckPayload(selectedDeck),
            },
        });
        storePlayerName(name);
        storeSession(targetGameId, pid);
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

    const handleDeleteDeck = (presetId: string) => {
        const deck = userDecks.find((d) => d.presetId === presetId);
        if (!deck) return;
        if (!window.confirm(`Delete "${deck.name}"?`)) return;
        deleteUserDeck(presetId);
        refreshUserDecks();
        if (storedPresetId === presetId) {
            setStoredPresetId(null);
            clearDeckPresetId();
        }
    };

    const handleNewDeck = () => {
        void navigate({ to: "/decks/create" });
    };

    if (presetDecks === undefined) {
        return (
            <div className="flex h-screen items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const renderUserActions = (deck: DeckPreset) => (
        <>
            <button
                onClick={() => handleEditDeck(deck.presetId)}
                className="rounded border border-white/20 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                title="Edit deck"
            >
                Edit
            </button>
            <button
                onClick={() => handleDeleteDeck(deck.presetId)}
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
                <p className="text-sm text-white/60">
                    Select a deck to continue.
                </p>
                <DeckList
                    title="My Decks"
                    decks={userDecks}
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
                    decks={presetDecks}
                    selectedPresetId={storedPresetId}
                    onFocus={handleFocusDeck}
                    onSelect={handleSelectDeck}
                />
            </div>
        );
    }

    const selectedIsUserDeck = isUserDeckId(selectedDeck.presetId);

    return (
        <div className="flex min-h-screen flex-col items-center gap-6 px-6 py-12 text-white">
            <h1 className="text-2xl font-bold">Tolaria</h1>

            <input
                type="text"
                placeholder="Your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="rounded border border-white/20 bg-white/5 px-4 py-2 text-center text-white placeholder:text-white/30"
            />

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
