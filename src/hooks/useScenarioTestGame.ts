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
    /** Concede the blocking active game via the right mutation for its type
     *  — `manualConcedeMatch` for `mode === "manual"`, `forfeitMatch`
     *  otherwise. `concede` (CR 104.3a) is NOT used: it only ends the current
     *  *Game*, leaving the *Match* — and therefore `findActiveMatchForUser`'s
     *  block — in place, so `createSoloGame` would still reject the retry.
     *  On success, retries the scenario launch that was blocked. */
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
    const launch = async (row: Doc<"debugScenarios">) => {
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
            if (activeGame) {
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
                if (blocked.mode === "manual") {
                    // ADR 0080 S12 twin of `forfeitMatch`: manual games run
                    // on `manualStates`, not GRE state, so ending the Match
                    // goes through `manualConcedeMatch` instead. Mirrors
                    // `ActiveGameNotice`'s manual branch, always as the P1
                    // seat (the admin's own active game — solo manual tables
                    // have both seats owned by this same user).
                    await manualConcedeMatch({
                        gameId: blocked.gameId,
                        playerId: `${user._id}-p1`,
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
                await launch(row);
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
