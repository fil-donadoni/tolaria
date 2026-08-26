import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canEditPresets } from "~/lib/adminGating";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useUserDecks, useUserDeckMutations } from "~/hooks/useUserDecks";
import {
    useJoinLimitedEvent,
    useMyCurrentLimitedEvents,
    useOpenLimitedEvents,
} from "~/hooks/useLimitedEvent";
import {
    deckPayload,
    filterDecksByFormat,
    selectPreset,
    toPresetLobbyDeck,
    type LobbyDeck,
} from "~/lib/deckTypes";
import { lobbyActionGate } from "~/lib/lobbyGate";
import {
    lobbyModeTiles,
    resolveLobbyMode,
    type LobbyModeKey,
} from "~/lib/lobbyModes";
import {
    clearAiDeckId,
    clearDeckPresetId,
    getStoredAiDeckId,
    getStoredDeckFormatFilter,
    getStoredDeckPresetId,
    getStoredDifficulty,
    getStoredMatchFormat,
    getStoredPlayMode,
    storeAiDeckId,
    storeDeckFormatFilter,
    storeDeckPresetId,
    storeDifficulty,
    storeMatchFormat,
    storePlayMode,
    storeSession,
    type DeckFormatFilter as DeckFormatFilterValue,
    type MatchFormat,
    type PlayMode,
} from "~/lib/session";
import type { Difficulty } from "@convex/gre";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import LoadingScreen from "~/components/ui/loading-screen";
import LobbyFooter from "~/components/legal/lobby-footer";
import ActionButton from "~/components/board/action-button";
import DashboardLimitedBox from "./dashboard-limited-box";
import VsAiSetupDialog from "./vs-ai-setup-dialog";
import JoinByCodeDialog from "./join-by-code-dialog";
import DeckFormatFilter from "./deck-format-filter";
import DeckShelf from "./deck-shelf";
import LobbyAmbient from "./lobby-ambient";
import LobbyBackground from "./lobby-background";
import LobbyLoadout from "./lobby-loadout";
import LobbyModeTiles from "./lobby-mode-tiles";
import OpenTablesStrip from "./open-tables-strip";
import PlayModeSelector from "./play-mode-selector";
import ActiveGameNotice from "./active-game-notice";
import { extractMutationErrorMessage } from "~/lib/mutation-error";

function Lobby() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const [storedPresetId, setStoredPresetId] = useState<string | null>(() =>
        getStoredDeckPresetId()
    );
    const [deleteTarget, setDeleteTarget] = useState<LobbyDeck | null>(null);
    // Two-step "Play vs AI" flow: the Bot Mode Tile's primary action opens this
    // dialog (the second step) where difficulty / AI deck are chosen; the match
    // starts only on Confirm. Match format is picked in the Loadout, not here.
    const [vsAiOpen, setVsAiOpen] = useState(false);
    const [joinByCodeOpen, setJoinByCodeOpen] = useState(false);
    const [difficulty, setDifficulty] = useState<Difficulty>(() =>
        getStoredDifficulty()
    );
    const [aiDeckId, setAiDeckId] = useState<string | null>(() =>
        getStoredAiDeckId()
    );
    const [matchFormat, setMatchFormat] = useState<MatchFormat>(() =>
        getStoredMatchFormat()
    );
    // Deck shelf Format filter (#513) — navigation only, persisted so the
    // choice survives a reload. Shared by BOTH shelves (it always was one piece
    // of state); the control lives in the "Your decks" header.
    const [deckFormatFilter, setDeckFormatFilter] =
        useState<DeckFormatFilterValue>(() => getStoredDeckFormatFilter());
    // Explicit game-mode selector (ADR 0101 §10, issue #2591): Arena mode |
    // Cockatrice mode. DRIVES deck filtering (both shelves below only show
    // decks compatible with the current mode) AND which Mode Tiles render —
    // the inverse of the pre-#2591 flow, which derived "manual or not" from
    // whichever deck happened to be selected. Kept deliberately separate from
    // `deckFormatFilter` above: the Format filter narrows WHICH format among
    // the mode-compatible ones, the mode decides compatible-or-not in the
    // first place.
    const [playMode, setPlayMode] = useState<PlayMode>(() =>
        getStoredPlayMode()
    );
    // The selected Mode Tile (ADR 0103 §6, issue #2726). Deliberately NOT
    // persisted: it names the one ivory primary action, and a menu that opens
    // on last session's choice is a menu that starts the wrong game for
    // whoever forgot. `resolveLobbyMode` falls back to the first OFFERED tile,
    // so a key stranded by a game-mode toggle can never name an action the
    // grid no longer shows.
    const [modeKey, setModeKey] = useState<LobbyModeKey>("bot");
    const [isBusy, setIsBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const userDecks = useUserDecks();
    const { remove: removeUserDeck } = useUserDeckMutations();
    const deletePreset = useMutation(api.decks.deletePreset);

    const pageVisible = usePageVisible();
    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const createGame = useMutation(api.game.createGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const createManualSoloGame = useMutation(api.game.createManualSoloGame);
    const createManualGame = useMutation(api.game.createManualGame);
    const joinGame = useMutation(api.game.joinGame);
    const joinManualGame = useMutation(api.game.joinManualGame);
    // Inline Join from the Limited footer's Open Events row (issue #2648) —
    // its own single `useMutation` call rather than pulling in
    // `useLimitedEventMutations()`'s other seven mutations for one field.
    const joinLimitedEventMutation = useMutation(
        api.limitedEvents.joinLimitedEvent
    );
    // "Join by code" (issue #2649). APPEND-ONLY position, and it must stay
    // LAST: `lobby.test.tsx` mocks `useMutation` by CALL ORDER
    // (`mutCall % handlers.length`), so a new hook inserted anywhere but the
    // end silently re-routes every mock after it with no failing assertion.
    // The `handlers` array over there ends with `joinGameByCode` for exactly
    // this reason — the two orders are one fact written twice.
    const joinGameByCode = useMutation(api.game.joinGameByCode);
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
    // The Limited footer's re-entry list (issue #1582) reuses the my-events
    // query wired in by #1589 — no new query.
    const myLimitedEvents = useMyCurrentLimitedEvents();
    // Open (joinable) events for the footer's "Open Events" row (issue #2648) —
    // the SAME query the `/limited` browse list already subscribes to
    // (`useOpenLimitedEvents`), narrowed client-side in `DashboardLimitedBox`
    // via `isLimitedEventJoinable` rather than a second, narrower query.
    const openLimitedEvents = useOpenLimitedEvents();

    const presetLobbyDecks = useMemo<LobbyDeck[]>(
        () => (presetDecks ?? []).map((d) => toPresetLobbyDeck(d)),
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

    // The Format filter narrows what's *shelved* only (#513). Selection
    // resolution still keys off `allDecks` so a stored selection of a now-
    // hidden deck is unaffected by the filter.
    //
    // The game-mode selector (issue #2591) narrows the SAME shelves a second,
    // orthogonal way, applied FIRST: Cockatrice mode shows only Manual Decks,
    // Arena mode shows every non-Manual deck. The Format filter then slices
    // further within whichever set the mode already picked (an Arena-mode
    // "Manual Game" Format filter can only ever show zero decks — correct:
    // switch to Cockatrice mode instead of fighting the filter).
    const filteredUserDecks = useMemo<LobbyDeck[]>(
        () =>
            filterDecksByFormat(
                userLobbyDecks.filter(
                    (d) =>
                        (d.format === "manual") === (playMode === "cockatrice")
                ),
                deckFormatFilter
            ),
        [userLobbyDecks, deckFormatFilter, playMode]
    );
    const filteredPresetDecks = useMemo<LobbyDeck[]>(
        () =>
            filterDecksByFormat(
                presetLobbyDecks.filter(
                    (d) =>
                        (d.format === "manual") === (playMode === "cockatrice")
                ),
                deckFormatFilter
            ),
        [presetLobbyDecks, deckFormatFilter, playMode]
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
            setActionError(extractMutationErrorMessage(err));
        } finally {
            setIsBusy(false);
        }
    };

    // One "Open a table" action, two backends: a Manual (Cockatrice-mode)
    // deck opens a Manual Game, anything else a real (Arena-mode) game. The
    // mode is a property of the DECK here (server-dispatched, ADR 0080),
    // never a separate tile — the two are mutually exclusive server-side
    // anyway, so a second tile could only ever be the wrong one half the
    // time. (The lobby's own game-mode SELECTOR, issue #2591, is a separate,
    // earlier decision: it drives which decks and which tiles are offered.)
    const handleCreate = () =>
        enterGame(async ({ user, deck }) => {
            const id =
                deck.format === "manual"
                    ? await createManualGame({
                          name: `${user.nickname}'s Manual Game`,
                          deck: deckPayload(deck),
                          bestOf: matchFormat,
                      })
                    : await createGame({
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

    const handleCreateTabletop = () =>
        enterGame(async ({ user, deck }) => {
            const id = await createManualSoloGame({
                name: `${user.nickname}'s Manual Game`,
                deck: deckPayload(deck),
                bestOf: matchFormat,
            });
            return { gameId: id, playerId: `${user._id}-p1` };
        });

    const handleJoin = (targetGameId: Id<"games">) =>
        enterGame(async ({ user, deck }) => {
            // Same dispatch as creation: the open row's mode decides which
            // join mutation runs. The row itself is already disabled when the
            // selected deck's format can't sit at that table.
            const target = openGames?.find((g) => g._id === targetGameId);
            if (target?.mode === "manual") {
                await joinManualGame({
                    gameId: targetGameId,
                    deck: deckPayload(deck),
                });
            } else {
                await joinGame({
                    gameId: targetGameId,
                    deck: deckPayload(deck),
                });
            }
            return { gameId: targetGameId, playerId: user._id };
        });

    /** Confirm step of the code-entry dialog (issue #2649). Deliberately NOT
     *  routed through `enterGame`: that helper swallows the failure into the
     *  lobby-wide error banner, and a rejected code has to come back to the
     *  dialog the user is still looking at. So this REJECTS on failure and the
     *  dialog renders the server's message — the only verdict on a code there
     *  is. The code is never resolved to a game id client-side; the mutation
     *  resolves it server-side and returns the game it seated us in. */
    const handleJoinByCode = async (code: string) => {
        // REJECTS rather than early-returning: `JoinByCodeDialog` treats a
        // resolved `onSubmit` as a successful join and closes itself, so a bare
        // `return` here would close the dialog having joined nothing and
        // navigated nowhere — a silent success. Unreachable through the
        // `canAct`-gated action today, which is exactly why it has to say so
        // rather than rely on staying unreachable.
        if (!selectedDeck || !user)
            throw new Error("Pick a deck before joining a table.");
        if (isBusy)
            throw new Error("Another action is still running. Try again.");
        setIsBusy(true);
        setActionError(null);
        try {
            const { gameId } = await joinGameByCode({
                code,
                deck: deckPayload(selectedDeck),
            });
            storeSession(gameId, user._id);
            void navigate({ to: "/game" });
        } finally {
            setIsBusy(false);
        }
    };

    const handleBrowseLimitedEvents = () => {
        void navigate({ to: "/limited" });
    };

    const handleOpenLimitedEvent = (eventId: Id<"limitedEvents">) => {
        void navigate({
            to: "/limited/$eventId",
            params: { eventId },
        });
    };

    // Reuses `/limited`'s own Join semantics (`limited-events-page.tsx`):
    // single in-flight guard, error surfaced rather than thrown, navigate to
    // the event's detail on success (issue #2648).
    const {
        handleJoin: handleJoinLimitedEvent,
        joinPendingEventId,
        joinError,
    } = useJoinLimitedEvent(joinLimitedEventMutation, handleOpenLimitedEvent);

    const handleViewAllLimitedEvents = () => {
        void navigate({ to: "/limited/events" });
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

    const handleMatchFormatChange = (next: MatchFormat) => {
        setMatchFormat(next);
        storeMatchFormat(next);
    };

    const handleDeckFormatFilterChange = (next: DeckFormatFilterValue) => {
        setDeckFormatFilter(next);
        storeDeckFormatFilter(next);
    };

    // Toggling the game-mode selector (issue #2591) can strand the current
    // selection: a real deck stays selected while Cockatrice mode filters the
    // shelves down to Manual Decks only (or vice versa), so `selectedDeck`
    // would point at a deck no longer offered anywhere in the UI. Mirrors the
    // null-safety pattern above (the stale-stored-preset-id effect): clear the
    // stored selection eagerly rather than let the Loadout carry a mismatched
    // deck across the toggle.
    const handlePlayModeChange = (next: PlayMode) => {
        setPlayMode(next);
        storePlayMode(next);
        const isManualDeck = selectedDeck?.format === "manual";
        const stillCompatible =
            !selectedDeck || isManualDeck === (next === "cockatrice");
        if (!stillCompatible) {
            setStoredPresetId(null);
            clearDeckPresetId();
        }
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

    // The Loadout's Edit, gated exactly as `deck-detail.route.tsx` gates its
    // own: a user deck always edits; a preset edits ONLY for an admin, and
    // `undefined` withholds the control from everyone else. Without the
    // `isAdmin` arm a normal player — whose selected deck is a preset in the
    // default start state — is offered "Edit" and routed to
    // `/presets/$slug/edit`, which has no client guard and can only fail at
    // its `assertIsAdmin` save. v3's Play box withheld it the same way
    // (`renderPresetActions = isAdmin ? … : undefined`).
    const handleEditSelectedDeck = !selectedDeck
        ? undefined
        : selectedDeck.kind === "user"
          ? () => handleEditDeck(selectedDeck.presetId)
          : isAdmin
            ? () => handleEditPreset(selectedDeck.presetId)
            : undefined;

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

    // The Mode Tiles the CURRENT game mode offers, and the one selected —
    // resolved through `resolveLobbyMode` so a key stranded by a mode toggle
    // falls back to a tile the grid actually renders.
    const modeTiles = lobbyModeTiles({
        mode: playMode,
        difficulty,
        liveLimitedEvents: openLimitedEvents?.length ?? 0,
    });
    const activeTile = resolveLobbyMode(modeTiles, modeKey);

    // ONE gate, shared with the Loadout, so an open-table row can never be
    // joinable under a condition the primary action refuses (`~/lib/lobbyGate`).
    const { canAct } = lobbyActionGate({
        deck: selectedDeck,
        mode: playMode,
        busy: isBusy,
        hasActiveGame: !!activeGame,
    });

    // Exhaustive over `LobbyModeKey`: adding a tile without giving it an
    // action is a type error here, not a dead plate on the screen.
    const runPrimaryAction = () => {
        switch (activeTile.key) {
            case "bot":
                setVsAiOpen(true);
                return;
            case "solo":
                void handleCreateSolo();
                return;
            case "table":
                void handleCreate();
                return;
            case "manual-solo":
                void handleCreateTabletop();
                return;
            case "limited":
                handleBrowseLimitedEvents();
                return;
        }
    };

    if (
        presetDecks === undefined ||
        userDecks === undefined ||
        user === undefined ||
        myLimitedEvents === undefined ||
        openLimitedEvents === undefined
    ) {
        return <LoadingScreen />;
    }

    return (
        // NO `overflow-hidden` here (issue #2274) — that class, not the height
        // claim, is what made `LobbyFooter` unreachable at 1440x900 and
        // 1920x1080. This root is a flex ITEM of `<main flex flex-1 min-h-0
        // overflow-y-auto>` with the default `flex-shrink: 1`, so `<main>`'s
        // height clamps it; per CSS Flexbox §4.5 hiding its overflow also drops
        // the `min-height: auto` floor that would otherwise let it grow, and
        // the excess is CLIPPED rather than handed to `<main>` (measured: 788
        // root / 788 scrollHeight / 0 maxScroll, at a 3212px column). Swapping
        // the height claim while KEEPING the clip changed nothing.
        //
        // `min-h-full` is the claim — the shell's remainder as a FLOOR, the
        // same shape the other state screens use — but there is no clip, so a
        // lobby taller than the remainder (an active-game notice, an error
        // banner, a long open-tables strip) grows past it and `<main>` scrolls
        // to its bottom. The v4 layout is BUDGETED to fit 1440x900 without
        // that ever engaging (issue #2726 AC #1): the Mode Tiles and the
        // Loadout share one row, and each deck collection costs ONE shelf of
        // height instead of a 28rem vertical scroller.
        //
        // `shell-height-claims.guard.test.tsx` re-derives all of this from
        // this exact className at nine desktop heights and three viewport
        // regimes; it is the test, not this comment, that holds it.
        <div className="relative min-h-full bg-surface-base text-text">
            <LobbyBackground />
            <LobbyAmbient
                featuredCardId={selectedDeck?.featuredCardId ?? null}
            />
            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4">
                {activeGame && user && (
                    <ActiveGameNotice
                        activeGame={activeGame}
                        userId={user._id}
                    />
                )}

                {actionError && <Banner tone="danger">{actionError}</Banner>}
                {joinError && <Banner tone="danger">{joinError}</Banner>}

                {/* Mode Tiles | Loadout + Deck Shelves (ADR 0103 §6). One row
                    from `lg:` up so the whole menu fits a desktop viewport;
                    one column below it, where the tiles come first because
                    the phone band puts destinations in `AppBottomNav` and the
                    thumb starts at the bottom of the column. */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
                    <div className="flex flex-col gap-3">
                        <PlayModeSelector
                            value={playMode}
                            onChange={handlePlayModeChange}
                            disabled={isBusy}
                        />
                        <LobbyModeTiles
                            tiles={modeTiles}
                            selected={activeTile.key}
                            onSelect={setModeKey}
                        />
                        <OpenTablesStrip
                            openGames={openGames}
                            mode={playMode}
                            onJoin={handleJoin}
                            canAct={canAct}
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <LobbyLoadout
                            deck={selectedDeck}
                            mode={playMode}
                            tile={activeTile}
                            matchFormat={matchFormat}
                            onMatchFormatChange={handleMatchFormatChange}
                            onPrimary={runPrimaryAction}
                            onJoinByCode={() => setJoinByCodeOpen(true)}
                            onEditDeck={handleEditSelectedDeck}
                            onChangeDeck={handleChangeDeck}
                            busy={isBusy}
                            hasActiveGame={!!activeGame}
                        />

                        <DeckShelf
                            title="Your decks"
                            decks={filteredUserDecks}
                            selectedPresetId={storedPresetId}
                            onSelect={handleSelectDeck}
                            onOpen={handleFocusDeck}
                            onEdit={handleEditDeck}
                            onDelete={handleDeleteDeck}
                            emptyLabel={
                                deckFormatFilter === "all"
                                    ? "No saved decks yet. Create one to start building."
                                    : "No saved decks match this format."
                            }
                            actions={
                                <>
                                    <DeckFormatFilter
                                        value={deckFormatFilter}
                                        onChange={handleDeckFormatFilterChange}
                                    />
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={handleNewDeck}
                                    >
                                        + New Deck
                                    </Button>
                                </>
                            }
                        />

                        <DeckShelf
                            title="Preset decks"
                            decks={filteredPresetDecks}
                            selectedPresetId={storedPresetId}
                            onSelect={handleSelectDeck}
                            onOpen={handleFocusDeck}
                            onEdit={isAdmin ? handleEditPreset : undefined}
                            onDelete={isAdmin ? handleDeletePreset : undefined}
                            emptyLabel={
                                deckFormatFilter === "all"
                                    ? "No preset decks available."
                                    : "No preset decks match this format."
                            }
                            actions={
                                isAdmin ? (
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={handleNewPreset}
                                        title="Create a new preset (admin)"
                                    >
                                        + New Preset
                                    </Button>
                                ) : undefined
                            }
                        />
                    </div>
                </div>

                {/* Live Limited events as footer cards (ADR 0103 §6). The
                    Limited ENTRY point is the fourth Mode Tile above; this
                    band is only what is already running (issue #2648). */}
                <DashboardLimitedBox
                    events={myLimitedEvents}
                    openEvents={openLimitedEvents}
                    onBrowse={handleBrowseLimitedEvents}
                    onOpen={handleOpenLimitedEvent}
                    onJoin={(eventId) => void handleJoinLimitedEvent(eventId)}
                    joinPendingEventId={joinPendingEventId}
                    onViewAllEvents={handleViewAllLimitedEvents}
                />

                <LobbyFooter />
            </div>

            <JoinByCodeDialog
                open={joinByCodeOpen}
                onOpenChange={setJoinByCodeOpen}
                onSubmit={handleJoinByCode}
            />
            <VsAiSetupDialog
                open={vsAiOpen}
                onOpenChange={setVsAiOpen}
                difficulty={difficulty}
                onDifficultyChange={handleDifficultyChange}
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
