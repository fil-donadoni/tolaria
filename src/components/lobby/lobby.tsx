import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canEditPresets } from "~/lib/adminGating";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useUserDecks, useUserDeckMutations } from "~/hooks/useUserDecks";
import {
    deckPayload,
    filterDecksByFormat,
    selectPreset,
    toPresetLobbyDeck,
    type LobbyDeck,
} from "~/lib/deckTypes";
import {
    clearAiDeckId,
    clearDeckPresetId,
    getStoredAiDeckId,
    getStoredDeckFormatFilter,
    getStoredDeckPresetId,
    getStoredDifficulty,
    getStoredMatchFormat,
    storeAiDeckId,
    storeDeckFormatFilter,
    storeDeckPresetId,
    storeDifficulty,
    storeMatchFormat,
    storeSession,
    type DeckFormatFilter as DeckFormatFilterValue,
    type MatchFormat,
} from "~/lib/session";
import type { Difficulty } from "@convex/gre";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import GameDialog from "~/components/ui/game-dialog";
import LoadingScreen from "~/components/ui/loading-screen";
import LobbyFooter from "~/components/legal/lobby-footer";
import ActionButton from "~/components/board/action-button";
import DashboardTopBar from "./dashboard-top-bar";
import DashboardPlayBox from "./dashboard-play-box";
import VsAiSetupDialog from "./vs-ai-setup-dialog";
import DeckList from "./deck-list";
import DeckFormatFilter from "./deck-format-filter";
import LobbyBackground from "./lobby-background";
import ActiveGameNotice from "./active-game-notice";

function Lobby() {
    const navigate = useNavigate();
    // Deep-link invite (`/?join=<gameId>`): a loosely-typed read so this stays
    // decoupled from the router module (which imports this component).
    const { join: joinParam } = useSearch({ strict: false }) as {
        join?: string;
    };
    const user = useCurrentUser();
    const [storedPresetId, setStoredPresetId] = useState<string | null>(() =>
        getStoredDeckPresetId()
    );
    const [deleteTarget, setDeleteTarget] = useState<LobbyDeck | null>(null);
    // Two-step "Play vs AI" flow: the Play panel button opens this dialog (the
    // second step) where difficulty / match format / AI deck are chosen; the
    // match starts only on Confirm.
    const [vsAiOpen, setVsAiOpen] = useState(false);
    const [difficulty, setDifficulty] = useState<Difficulty>(() =>
        getStoredDifficulty()
    );
    const [aiDeckId, setAiDeckId] = useState<string | null>(() =>
        getStoredAiDeckId()
    );
    const [matchFormat, setMatchFormat] = useState<MatchFormat>(() =>
        getStoredMatchFormat()
    );
    // Deck-list Format filter (#513) — navigation only, persisted so the choice
    // survives a reload. Shared by both deck panels; default "all".
    const [deckFormatFilter, setDeckFormatFilter] =
        useState<DeckFormatFilterValue>(() => getStoredDeckFormatFilter());
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const userDecks = useUserDecks();
    const { remove: removeUserDeck } = useUserDeckMutations();
    const deletePreset = useMutation(api.decks.deletePreset);

    const pageVisible = usePageVisible();
    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const createGame = useMutation(api.game.createGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const joinGame = useMutation(api.game.joinGame);
    const openGames = useQuery(
        api.game.listOpenGames,
        pageVisible ? {} : "skip"
    );
    // #155: a user holds at most one active game. When one exists the lobby
    // surfaces it (resume / leave) instead of attempting a rejected creation.
    const activeGame = useQuery(
        api.game.myActiveGame,
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

    // The Format filter narrows what's *listed* only (#513). Selection
    // resolution still keys off `allDecks` so a stored selection of a now-
    // hidden deck is unaffected by the filter.
    const filteredUserDecks = useMemo<LobbyDeck[]>(
        () => filterDecksByFormat(userLobbyDecks, deckFormatFilter),
        [userLobbyDecks, deckFormatFilter]
    );
    const filteredPresetDecks = useMemo<LobbyDeck[]>(
        () => filterDecksByFormat(presetLobbyDecks, deckFormatFilter),
        [presetLobbyDecks, deckFormatFilter]
    );

    // Null-safe: a stale stored id (e.g. an admin deleted the preset it pointed
    // at, issue #470) resolves to no selection instead of throwing.
    const selectedDeck = useMemo(
        () => selectPreset(allDecks, storedPresetId),
        [allDecks, storedPresetId]
    );

    // null aiDeckId → mirror the human's deck. A stale id (deleted deck) also
    // resolves to null here and silently falls back to mirror at create time.
    const selectedAiDeck = useMemo(
        () => selectPreset(allDecks, aiDeckId),
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

    // Runs a create/join mutation, then enters the game. Centralises the busy
    // guard and surfaces a rejection (e.g. #155 single-active-game guard) as
    // clear feedback instead of an uncaught error.
    const enterGame = async (
        run: (ctx: {
            user: NonNullable<typeof user>;
            deck: LobbyDeck;
        }) => Promise<{ gameId: Id<"games">; playerId: string }>
    ) => {
        if (isBusy || !selectedDeck || !user) return;
        setIsBusy(true);
        setActionError(null);
        try {
            const { gameId, playerId } = await run({
                user,
                deck: selectedDeck,
            });
            storeSession(gameId, playerId);
            void navigate({ to: "/game" });
        } catch (err) {
            setActionError(
                err instanceof Error ? err.message : "Failed to start game."
            );
        } finally {
            setIsBusy(false);
        }
    };

    const handleCreate = () =>
        enterGame(async ({ user, deck }) => {
            const id = await createGame({
                name: `${user.nickname}'s game`,
                deck: deckPayload(deck),
                bestOf: matchFormat,
            });
            return { gameId: id, playerId: user._id };
        });

    const handleCreateSolo = () =>
        enterGame(async ({ user, deck }) => {
            const id = await createSoloGame({
                name: `${user.nickname}'s solo game`,
                deck: deckPayload(deck),
                bestOf: matchFormat,
            });
            return { gameId: id, playerId: `${user._id}-p1` };
        });

    // Confirm step of the vs-AI dialog. `enterGame` navigates away on success;
    // on failure the dialog stays open so the user can retry or cancel after
    // reading the surfaced error.
    const handleCreateVsAi = () =>
        enterGame(async ({ user, deck }) => {
            const id = await createSoloGame({
                name: `${user.nickname} vs AI`,
                deck: deckPayload(deck),
                deck2: selectedAiDeck ? deckPayload(selectedAiDeck) : undefined,
                vsAi: true,
                bestOf: matchFormat,
            });
            return { gameId: id, playerId: `${user._id}-p1` };
        });

    const handleJoin = (targetGameId: Id<"games">) =>
        enterGame(async ({ user, deck }) => {
            await joinGame({
                gameId: targetGameId,
                deck: deckPayload(deck),
            });
            return { gameId: targetGameId, playerId: user._id };
        });

    // Deep-link auto-join (`/?join=<gameId>`). Fires once, only when the
    // visitor is ready to be credited: authenticated, holding a selected deck,
    // and not already tied to an active game (#155 — a host visiting their own
    // link, or a user mid-game, falls through to the ActiveGameNotice/lobby
    // instead of a rejected join). Missing deck keeps the link pending and
    // surfaces a prompt (below); the effect re-fires once a deck is picked.
    const joinFiredRef = useRef(false);
    useEffect(() => {
        if (joinFiredRef.current) return;
        if (!joinParam || !user || !selectedDeck || activeGame || isBusy)
            return;
        joinFiredRef.current = true;
        // Strip the param so a later back-navigation doesn't retry the join.
        void navigate({ to: "/", search: {}, replace: true });
        // Deferred out of the effect body: handleJoin → enterGame sets state
        // synchronously, which must not run during the effect's commit phase.
        queueMicrotask(() => void handleJoin(joinParam as Id<"games">));
        // handleJoin is recreated each render; the ref guard makes this fire-once
        // regardless, so it is intentionally excluded from the deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [joinParam, user, selectedDeck, activeGame, isBusy, navigate]);

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

    const handleMatchFormatChange = (next: MatchFormat) => {
        setMatchFormat(next);
        storeMatchFormat(next);
    };

    const handleDeckFormatFilterChange = (next: DeckFormatFilterValue) => {
        setDeckFormatFilter(next);
        storeDeckFormatFilter(next);
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

    // Admin-only: open the shared editor in preset mode (PRD #466, ADR 0033).
    const handleEditPreset = (presetId: string) => {
        void navigate({
            to: "/presets/$slug/edit",
            params: { slug: presetId },
        });
    };

    const isAdmin = canEditPresets(user);

    const handleDeleteDeck = (presetId: string) => {
        const deck = userLobbyDecks.find((d) => d.presetId === presetId);
        if (!deck || deck.kind !== "user") return;
        setDeleteTarget(deck);
    };

    // Admin-only: open the in-app confirmation for deleting a preset (issue
    // #470). Never the native confirm() — it freezes the MCP debug session.
    const handleDeletePreset = (presetId: string) => {
        const deck = presetLobbyDecks.find((d) => d.presetId === presetId);
        if (!deck || deck.kind !== "preset") return;
        setDeleteTarget(deck);
    };

    // Clears a stored lobby selection that pointed at the just-deleted deck so
    // the next render falls back to no selection (selectPreset is null-safe
    // even if this is skipped — this is the eager local clear).
    const clearSelectionIfDeleted = (presetId: string) => {
        if (storedPresetId === presetId) {
            setStoredPresetId(null);
            clearDeckPresetId();
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        const target = deleteTarget;
        setDeleteTarget(null);
        setActionError(null);
        try {
            if (target.kind === "user") {
                await removeUserDeck({ id: target.userDeckId });
            } else {
                // Server re-checks admin via assertIsAdmin — the UI gate is
                // cosmetic. After the hard delete the preset leaves
                // api.decks.list reactively for every client.
                await deletePreset({ slug: target.presetId });
            }
            clearSelectionIfDeleted(target.presetId);
        } catch (err) {
            setActionError(
                err instanceof Error ? err.message : "Failed to delete deck."
            );
        }
    };

    const handleNewDeck = () => {
        // Carry the selected format filter into the new deck so it opens on that
        // format instead of resetting to Freeform. "all" seeds nothing (the
        // builder falls back to its default).
        void navigate({
            to: "/decks/create",
            search:
                deckFormatFilter === "all" ? {} : { format: deckFormatFilter },
        });
    };

    // Admin-only: open the shared editor to author a brand-new preset (issue
    // #469). The slug is derived from the name on first save (server-gated by
    // `assertIsAdmin`); the new preset then appears in every client's lobby.
    const handleNewPreset = () => {
        void navigate({ to: "/presets/create" });
    };

    if (
        presetDecks === undefined ||
        userDecks === undefined ||
        user === undefined
    ) {
        return <LoadingScreen />;
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

    const renderPresetActions = isAdmin
        ? (deck: LobbyDeck) => (
              <>
                  <button
                      onClick={() => handleEditPreset(deck.presetId)}
                      className="btn-base btn-tone-secondary px-3 py-2 text-xs"
                      title="Edit preset (admin)"
                  >
                      Edit
                  </button>
                  <button
                      onClick={() => handleDeletePreset(deck.presetId)}
                      className="btn-base btn-tone-destructive px-3 py-2 text-xs"
                      title="Delete preset (admin)"
                  >
                      Delete
                  </button>
              </>
          )
        : undefined;

    return (
        <div className="relative min-h-dvh overflow-hidden bg-surface-base text-text">
            <LobbyBackground />
            <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
                <DashboardTopBar />

                {activeGame && user && (
                    <ActiveGameNotice
                        activeGame={activeGame}
                        userId={user._id}
                    />
                )}

                {actionError && (
                    <div className="rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                        {actionError}
                    </div>
                )}

                {joinParam && !selectedDeck && !activeGame && (
                    <div className="rounded-sm border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-text">
                        Select a deck below to join the game you were invited
                        to.
                    </div>
                )}

                <DashboardPlayBox
                    selectedDeck={selectedDeck}
                    openGames={openGames}
                    onCreateVsAi={() => setVsAiOpen(true)}
                    onCreateSolo={handleCreateSolo}
                    onCreateMultiplayer={handleCreate}
                    onJoin={handleJoin}
                    onChangeDeck={handleChangeDeck}
                    busy={isBusy}
                    hasActiveGame={!!activeGame}
                />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Panel className="flex max-h-[28rem] flex-col">
                        <PanelHeader title="My Decks" />
                        <PanelBody className="min-h-0 flex-1">
                            <div className="flex items-center justify-end gap-3">
                                <DeckFormatFilter
                                    value={deckFormatFilter}
                                    onChange={handleDeckFormatFilterChange}
                                />
                                <button
                                    onClick={handleNewDeck}
                                    className="btn-base btn-tone-primary px-3 py-1.5 text-xs"
                                >
                                    + New Deck
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <DeckList
                                    decks={filteredUserDecks}
                                    selectedPresetId={storedPresetId}
                                    onFocus={handleFocusDeck}
                                    onSelect={handleSelectDeck}
                                    emptyLabel={
                                        deckFormatFilter === "all"
                                            ? "No saved decks yet. Create one to start building."
                                            : "No saved decks match this format."
                                    }
                                    renderActions={renderUserActions}
                                />
                            </div>
                        </PanelBody>
                    </Panel>

                    <Panel className="flex max-h-[28rem] flex-col">
                        <PanelHeader title="Preset Decks" />
                        <PanelBody className="min-h-0 flex-1">
                            <div className="flex items-center justify-end gap-3">
                                <DeckFormatFilter
                                    value={deckFormatFilter}
                                    onChange={handleDeckFormatFilterChange}
                                />
                                {isAdmin && (
                                    <button
                                        onClick={handleNewPreset}
                                        className="btn-base btn-tone-primary px-3 py-1.5 text-xs"
                                        title="Create a new preset (admin)"
                                    >
                                        + New Preset
                                    </button>
                                )}
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <DeckList
                                    decks={filteredPresetDecks}
                                    selectedPresetId={storedPresetId}
                                    onFocus={handleFocusDeck}
                                    onSelect={handleSelectDeck}
                                    emptyLabel={
                                        deckFormatFilter === "all"
                                            ? undefined
                                            : "No preset decks match this format."
                                    }
                                    renderActions={renderPresetActions}
                                />
                            </div>
                        </PanelBody>
                    </Panel>
                </div>

                <LobbyFooter />
            </div>

            <VsAiSetupDialog
                open={vsAiOpen}
                onOpenChange={setVsAiOpen}
                difficulty={difficulty}
                onDifficultyChange={handleDifficultyChange}
                matchFormat={matchFormat}
                onMatchFormatChange={handleMatchFormatChange}
                decks={allDecks}
                aiDeckId={aiDeckId}
                onAiDeckChange={handleAiDeckChange}
                onConfirm={handleCreateVsAi}
                pending={isBusy}
            />

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
