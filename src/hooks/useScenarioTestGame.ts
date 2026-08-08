// "Test" one saved scenario from `/admin/scenarios`: spin up a fresh SOLO game
// and apply the scenario to it immediately, then land on the board.
//
// Why solo: the scenario builder (`debugSetupScenario`) rewrites both seats'
// boards, so a scenario is only meaningful when one person drives both — which
// is exactly the mode the Chrome-debug workflow already prescribes. Bo1,
// because a scenario is a position, not a match.
//
// The deck is incidental — `debugSetupScenario` replaces the board it deals —
// but `createSoloGame` requires one, so this takes the lobby's persisted
// selection when it resolves and otherwise falls back to the first preset. The
// order (create → store session → apply spec → navigate) matters: navigating
// before the spec lands would show one frame of the dealt opening hand before
// the scenario replaced it.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { normalizeScenarioSpec } from "@convex/debugScenarioSpec";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { deckPayload, toPresetLobbyDeck } from "@/lib/deckTypes";
import { getStoredDeckPresetId, storeSession } from "@/lib/session";

/** The user's active game as reported by `myActiveGame` — the exact shape a
 *  blocked `test()` reads to decide whether (and how) to offer a concede. */
export type ActiveGameInfo = NonNullable<
    FunctionReturnType<typeof api.game.myActiveGame>
>;

/** A `test()` click blocked because the user already has an active game
 *  (issue #2400, `createSoloGame`'s #155 one-active-game rule). Carries the
 *  row to retry once the active game is conceded, plus the active game
 *  itself so a confirm dialog can name its type/opponent and the hook can
 *  pick the right concede mutation.
 *
 *  Set ONLY when the reactive `myActiveGame` subscription already reported a
 *  game BEFORE this `launch()` attempt touched anything — never by parsing
 *  the thrown error's message. `createSoloGame` throws a single fixed string
 *  (`ACTIVE_GAME_MESSAGE`) with no structured discriminator, and string-
 *  matching it would also mis-fire on a `debugSetupScenario` failure that
 *  happens to run while the game *this same call* just created is active
 *  (that failure must keep surfacing as the plain error banner, not this
 *  dialog — see the two separate try/catch blocks in `launch` below). */
export type BlockingActiveGame = {
    row: Doc<"debugScenarios">;
    activeGame: ActiveGameInfo;
};

export interface ScenarioTestGame {
    /** Start a game on this scenario. No-op while another launch is running. */
    test: (row: Doc<"debugScenarios">) => void;
    /** The row currently being launched, if any — for a per-row busy label. */
    launchingId: string | null;
    /** Last failure, e.g. a `debugSetupScenario` error unrelated to an
     *  active-game block (that case sets `blockingActiveGame` instead). */
    error: string | null;
    clearError: () => void;
    /** Set when `test()` was blocked by a pre-existing active game — render a
     *  confirm-and-retry dialog instead of the plain error banner. */
    blockingActiveGame: BlockingActiveGame | null;
    /** Dismiss the confirm dialog without touching the active game. */
    cancelBlockingActiveGame: () => void;
    /** Free the blocking active game via the right verb for its status/type,
     *  then retry the scenario launch that was blocked:
     *  - `status === "waiting" || status === "pregame"` (a lobby waiting room
     *    nobody joined, or a `pregame` coin-toss gate) has no Game worth
     *    conceding — mirrors `ActiveGameNotice`'s non-`playing` branch and
     *    uses `leaveGame`. A `waiting` 2-player Match has only ONE seat, so
     *    `forfeitMatch`'s opponent lookup would throw "Seat not found in
     *    this match" (#2400 review round 2). These are the EXACT statuses
     *    `leaveGame` accepts — `status !== "playing"` is too wide, since a
     *    Bo3 mid-Match can have a `finished` Game row while the Match is
     *    still active (#2400 review round 2, round 3 fix).
     *  - otherwise (including `finished`), `manualConcedeMatch` for
     *    `mode === "manual"`, `forfeitMatch` otherwise. `concede`
     *    (CR 104.3a) is NOT used: it only ends the current *Game*, leaving
     *    the *Match* — and therefore `findActiveMatchForUser`'s block — in
     *    place, so `createSoloGame` would still reject the retry. */
    resolveBlockingActiveGame: () => void;
    /** True while the concede mutation above (and the retried launch) is in
     *  flight — disables the confirm dialog's buttons. */
    resolvingActiveGame: boolean;
}

export function useScenarioTestGame(): ScenarioTestGame {
    const user = useCurrentUser();
    const navigate = useNavigate();
    const presetDecks = useQuery(api.decks.list, {});
    const activeGame = useQuery(api.game.myActiveGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const forfeitMatch = useMutation(api.game.forfeitMatch);
    const manualConcedeMatch = useMutation(api.game.manualConcedeMatch);
    const leaveGame = useMutation(api.game.leaveGame);

    const [launchingId, setLaunchingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [blockingActiveGame, setBlockingActiveGame] =
        useState<BlockingActiveGame | null>(null);
    const [resolvingActiveGame, setResolvingActiveGame] = useState(false);

    // Shared by the first attempt and the post-concede retry: create → store
    // session → apply spec → navigate. A failure in the create step is the
    // only one that can be the #155 active-game block; a failure applying the
    // scenario to a game THIS call just created is a different problem and
    // always surfaces as the plain error banner.
    //
    // `isRetry` (#2400 review round 2): set only by `resolveBlockingActiveGame`
    // below, right after it just conceded `blockingActiveGame.activeGame`. On
    // this specific call, `activeGame` — the reactive `myActiveGame` value —
    // is a STALE closure: it was captured when this `launch` closure was
    // created, at or before the confirm click, and the async retry never
    // re-renders the component before running, so it still describes the
    // game that was JUST conceded, not the live subscription. Re-entering
    // `if (activeGame)` on a retry failure would re-open the confirm dialog
    // describing an already-conceded game and swallow whatever the retried
    // `createSoloGame` actually threw — exactly the misrouting the split
    // try/catch below exists to prevent. `isRetry` short-circuits that
    // regardless of how stale (or fresh) the closure happens to be.
    const launch = async (
        row: Doc<"debugScenarios">,
        opts: { isRetry?: boolean } = {}
    ) => {
        // Point-free `.map(toPresetLobbyDeck)` would pass the array index
        // into the helper's optional banlist-override parameter.
        const decks = (presetDecks ?? []).map((d) => toPresetLobbyDeck(d));
        const storedId = getStoredDeckPresetId();
        const deck =
            decks.find((d) => d.presetId === storedId) ?? decks[0] ?? null;
        if (!deck || !user) {
            setError("No deck available to start a scenario game with.");
            return;
        }

        setLaunchingId(row._id);
        let gameId: Id<"games">;
        try {
            gameId = await createSoloGame({
                name: `Scenario: ${row.label}`,
                deck: deckPayload(deck),
                bestOf: 1,
            });
        } catch (e) {
            setLaunchingId(null);
            if (!opts.isRetry && activeGame) {
                setBlockingActiveGame({ row, activeGame });
            } else {
                setError(
                    e instanceof Error ? e.message : "Failed to start the game."
                );
            }
            return;
        }

        try {
            storeSession(gameId, `${user._id}-p1`);
            // Tolerant load (ADR 0044): drop unknown fields, default the
            // missing ones, then hand clean args to the unchanged builder.
            await setupScenario({
                gameId,
                ...normalizeScenarioSpec(row.spec),
            });
            void navigate({ to: "/game" });
        } catch (e) {
            setError(
                e instanceof Error ? e.message : "Failed to start the game."
            );
        } finally {
            setLaunchingId(null);
        }
    };

    const test = (row: Doc<"debugScenarios">) => {
        if (launchingId !== null || !user) return;
        setError(null);
        setBlockingActiveGame(null);
        void launch(row);
    };

    const cancelBlockingActiveGame = () => setBlockingActiveGame(null);

    const resolveBlockingActiveGame = () => {
        if (!blockingActiveGame || resolvingActiveGame || !user) return;
        const { row, activeGame: blocked } = blockingActiveGame;
        setResolvingActiveGame(true);
        void (async () => {
            try {
                if (
                    blocked.status === "waiting" ||
                    blocked.status === "pregame"
                ) {
                    // A `waiting` room (nobody joined) or a `pregame`
                    // coin-toss gate has no real opponent/Game to concede —
                    // mirrors `ActiveGameNotice`'s non-`playing` branch,
                    // which abandons via `leaveGame` regardless of mode.
                    //
                    // Gate on the EXACT statuses `leaveGame` accepts, not
                    // `status !== "playing"` (#2400 review round 2, blocking,
                    // round 3): `myActiveGame` reports the GAME row's status
                    // (`waiting | pregame | playing | finished`), and
                    // `finished` is reachable while the Match is still
                    // active — a Bo3 whose G1 just ended has a `finished`
                    // Game row but a Match sitting in `sideboarding` (an
                    // ACTIVE_MATCH_STATUS), with `currentGameId` still
                    // pointing at the finished Game. `leaveGame` only
                    // accepts `waiting`/`pregame` and throws otherwise
                    // ("Cannot leave a game in progress; concede instead"),
                    // so a wide `!== "playing"` check would route a
                    // `finished`-but-still-in-Match block into a throw that
                    // never frees the user. Everything else (including
                    // `finished`) falls through to the concede/forfeit
                    // branches below, which is what round 1 did
                    // unconditionally and is correct here too.
                    await leaveGame({ gameId: blocked.gameId });
                } else if (blocked.mode === "manual") {
                    // ADR 0080 S12 twin of `forfeitMatch`: manual games run
                    // on `manualStates`, not GRE state, so ending the Match
                    // goes through `manualConcedeMatch` instead. Same seat
                    // derivation as the non-manual branch below: solo/vs-AI
                    // seats are `${userId}-p1`, a genuine 2-player manual
                    // table (`createManualGame`/`joinManualGame`) seats the
                    // caller as the bare user id (#2400 review round 2 —
                    // passing `-p1` unconditionally mis-resolved the seat
                    // lookup and could record the concede as a win for the
                    // conceder).
                    await manualConcedeMatch({
                        gameId: blocked.gameId,
                        playerId: blocked.solo ? `${user._id}-p1` : user._id,
                    });
                } else {
                    // Solo/vs-AI seats are `${userId}-p1`; a bare 2-player
                    // seat is the user id itself (mirrors `ActiveGameNotice`).
                    await forfeitMatch({
                        matchId: blocked.matchId,
                        playerId: blocked.solo ? `${user._id}-p1` : user._id,
                    });
                }
                setBlockingActiveGame(null);
                await launch(row, { isRetry: true });
            } catch (e) {
                setBlockingActiveGame(null);
                setError(
                    e instanceof Error
                        ? e.message
                        : "Failed to concede the active game."
                );
            } finally {
                setResolvingActiveGame(false);
            }
        })();
    };

    return {
        test,
        launchingId,
        error,
        clearError: () => setError(null),
        blockingActiveGame,
        cancelBlockingActiveGame,
        resolveBlockingActiveGame,
        resolvingActiveGame,
    };
}
