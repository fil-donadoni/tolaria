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
    clearAiDeckId,
    clearDeckPresetId,
    getStoredAiDeckId,
    getStoredDeckPresetId,
    getStoredDifficulty,
    storeAiDeckId,
    storeDeckPresetId,
    storeDifficulty,
    storeSession,
} from "~/lib/session";
import type { Difficulty } from "@convex/gre";
import { Panel } from "~/components/ui/panel";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import DashboardTopBar from "./dashboard-top-bar";
import DashboardPlayBox from "./dashboard-play-box";
import DeckList from "./deck-list";
import LobbyBackground from "./lobby-background";

function Lobby() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const [storedPresetId, setStoredPresetId] = useState<string | null>(() =>
        getStoredDeckPresetId()
    );
    const [deleteTarget, setDeleteTarget] = useState<LobbyDeck | null>(null);
    const [difficulty, setDifficulty] = useState<Difficulty>(() =>
        getStoredDifficulty()
    );
    const [aiDeckId, setAiDeckId] = useState<string | null>(() =>
        getStoredAiDeckId()
    );
    const [isBusy, setIsBusy] = useState(false);
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

    // null aiDeckId → mirror the human's deck. A stale id (deleted deck) also
    // resolves to null here and silently falls back to mirror at create time.
    const selectedAiDeck = useMemo(
        () => allDecks.find((d) => d.presetId === aiDeckId) ?? null,
        [allDecks, aiDeckId]
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
        if (isBusy || !selectedDeck || !user) return;
        setIsBusy(true);
        try {
            const id = await createGame({
                name: `${user.nickname}'s game`,
                deck: deckPayload(selectedDeck),
            });
            storeSession(id, user._id);
            void navigate({ to: "/game" });
        } finally {
            setIsBusy(false);
        }
    };

    const handleCreateSolo = async () => {
        if (isBusy || !selectedDeck || !user) return;
        setIsBusy(true);
        try {
            const id = await createSoloGame({
                name: `${user.nickname}'s solo game`,
                deck: deckPayload(selectedDeck),
            });
            storeSession(id, `${user._id}-p1`);
            void navigate({ to: "/game" });
        } finally {
            setIsBusy(false);
        }
    };

    const handleCreateVsAi = async () => {
        if (isBusy || !selectedDeck || !user) return;
        setIsBusy(true);
        try {
            const id = await createSoloGame({
                name: `${user.nickname} vs AI`,
                deck: deckPayload(selectedDeck),
                deck2: selectedAiDeck ? deckPayload(selectedAiDeck) : undefined,
                vsAi: true,
            });
            storeSession(id, `${user._id}-p1`);
            void navigate({ to: "/game" });
        } finally {
            setIsBusy(false);
        }
    };

    const handleJoin = async (targetGameId: Id<"games">) => {
        if (isBusy || !selectedDeck || !user) return;
        setIsBusy(true);
        try {
            await joinGame({
                gameId: targetGameId,
                deck: deckPayload(selectedDeck),
            });
            storeSession(targetGameId, user._id);
            void navigate({ to: "/game" });
        } finally {
            setIsBusy(false);
        }
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

    const handleDifficultyChange = (next: Difficulty) => {
        setDifficulty(next);
        storeDifficulty(next);
    };

    const handleAiDeckChange = (next: string | null) => {
        setAiDeckId(next);
        if (next === null) clearAiDeckId();
        else storeAiDeckId(next);
    };

    const handleEditDeck = (presetId: string) => {
        void navigate({
            to: "/decks/$slug/edit",
            params: { slug: presetId },
        });
    };

    const handleDeleteDeck = (presetId: string) => {
        const deck = userLobbyDecks.find((d) => d.presetId === presetId);
        if (!deck || deck.kind !== "user") return;
        setDeleteTarget(deck);
    };

    const confirmDelete = async () => {
        if (!deleteTarget || deleteTarget.kind !== "user") return;
        const presetId = deleteTarget.presetId;
        await removeUserDeck({ id: deleteTarget.userDeckId });
        if (storedPresetId === presetId) {
            setStoredPresetId(null);
            clearDeckPresetId();
        }
        setDeleteTarget(null);
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
            <div className="flex h-dvh items-center justify-center text-text">
                Loading...
            </div>
        );
    }

    const renderUserActions = (deck: LobbyDeck) => (
        <>
            <button
                onClick={() => handleEditDeck(deck.presetId)}
                className="btn-base btn-tone-secondary px-3 py-2 text-xs"
                title="Edit deck"
            >
                Edit
            </button>
            <button
                onClick={() => handleDeleteDeck(deck.presetId)}
                className="btn-base btn-tone-destructive px-3 py-2 text-xs"
                title="Delete deck"
            >
                Delete
            </button>
        </>
    );

    return (
        <div className="relative min-h-dvh overflow-hidden bg-surface-base text-text">
            <LobbyBackground />
            <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
                <DashboardTopBar />

                <DashboardPlayBox
                    selectedDeck={selectedDeck}
                    openGames={openGames}
                    difficulty={difficulty}
                    onDifficultyChange={handleDifficultyChange}
                    decks={allDecks}
                    aiDeckId={aiDeckId}
                    onAiDeckChange={handleAiDeckChange}
                    onCreateSolo={handleCreateSolo}
                    onCreateVsAi={handleCreateVsAi}
                    onCreateMultiplayer={handleCreate}
                    onJoin={handleJoin}
                    onChangeDeck={handleChangeDeck}
                    busy={isBusy}
                />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Panel className="max-h-[400px]">
                        <div className="overflow-auto max-h-[calc(400px-3rem)]">
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
                                        className="btn-base btn-tone-primary px-3 py-1.5 text-xs"
                                    >
                                        + New Deck
                                    </button>
                                }
                            />
                        </div>
                    </Panel>

                    <Panel className="max-h-[400px]">
                        <div className="overflow-auto max-h-[calc(400px-3rem)]">
                            <DeckList
                                title="Preset Decks"
                                decks={presetLobbyDecks}
                                selectedPresetId={storedPresetId}
                                onFocus={handleFocusDeck}
                                onSelect={handleSelectDeck}
                            />
                        </div>
                    </Panel>
                </div>
            </div>

            <GameDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
                title={`Delete "${deleteTarget?.name ?? ""}"?`}
                subtitle="This action cannot be undone."
            >
                <div className="flex justify-end gap-2 mt-4">
                    <ActionButton
                        onClick={() => setDeleteTarget(null)}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={() => void confirmDelete()}
                        label="Delete"
                        tone="destructive"
                    />
                </div>
            </GameDialog>
        </div>
    );
}

export default Lobby;
