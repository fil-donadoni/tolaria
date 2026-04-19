import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import DeckList from "./deck-list";
import DeckDetail from "./deck-detail";

interface LobbyProps {
    onEnter: (gameId: Id<"games">, playerId: string) => void;
}

function Lobby({ onEnter }: LobbyProps) {
    const [playerName, setPlayerName] = useState(() => getStoredPlayerName());
    const [storedPresetId, setStoredPresetId] = useState<string | null>(() =>
        getStoredDeckPresetId()
    );
    const [focusedPresetId, setFocusedPresetId] = useState<string | null>(null);
    const clientId = useMemo(() => getOrCreateClientId(), []);

    const pageVisible = usePageVisible();
    const decks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const seedIfEmpty = useMutation(api.decks.seedIfEmpty);
    const createGame = useMutation(api.game.createGame);
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

    useEffect(() => {
        if (decks && decks.length === 0) {
            void seedIfEmpty({});
        }
    }, [decks, seedIfEmpty]);

    const selectedDeck = useMemo(
        () => decks?.find((d) => d.presetId === storedPresetId) ?? null,
        [decks, storedPresetId]
    );
    const focusedDeck = useMemo(
        () => decks?.find((d) => d.presetId === focusedPresetId) ?? null,
        [decks, focusedPresetId]
    );

    useEffect(() => {
        if (decks && storedPresetId && !selectedDeck) {
            clearDeckPresetId();
        }
    }, [decks, storedPresetId, selectedDeck]);

    const canPlay = !!selectedDeck && playerName.trim().length > 0;

    const deckPayload = (d: NonNullable<typeof selectedDeck>) => ({
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
        onEnter(id, pid);
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
        onEnter(targetGameId, pid);
    };

    const handleSelectDeck = (presetId: string) => {
        setStoredPresetId(presetId);
        storeDeckPresetId(presetId);
        setFocusedPresetId(null);
    };

    const handleChangeDeck = () => {
        setStoredPresetId(null);
        clearDeckPresetId();
    };

    if (focusedDeck) {
        return (
            <DeckDetail
                deck={focusedDeck}
                isSelected={
                    !!selectedDeck &&
                    focusedDeck.presetId === selectedDeck.presetId
                }
                onBack={() => setFocusedPresetId(null)}
                onSelect={() => handleSelectDeck(focusedDeck.presetId)}
            />
        );
    }

    if (decks === undefined) {
        return (
            <div className="flex h-screen items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    if (decks.length === 0) {
        return (
            <div className="flex h-screen items-center justify-center text-white">
                Loading decks...
            </div>
        );
    }

    if (!selectedDeck) {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-6 text-white">
                <h1 className="text-2xl font-bold">Tolaria</h1>
                <p className="text-sm text-white/60">
                    Select a deck to continue.
                </p>
                <DeckList
                    decks={decks}
                    selectedPresetId={null}
                    onFocus={setFocusedPresetId}
                />
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col items-center justify-center gap-6 text-white">
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
                <button
                    onClick={() => setFocusedPresetId(selectedDeck.presetId)}
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                >
                    View
                </button>
                <button
                    onClick={handleChangeDeck}
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                >
                    Change Deck
                </button>
            </div>

            <button
                onClick={handleCreate}
                disabled={!canPlay}
                className="rounded bg-white/10 px-6 py-3 text-lg hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
                Create Game
            </button>

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
