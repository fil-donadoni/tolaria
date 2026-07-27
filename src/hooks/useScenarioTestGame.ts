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
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { normalizeScenarioSpec } from "@convex/debugScenarioSpec";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { deckPayload, toPresetLobbyDeck } from "@/lib/deckTypes";
import { getStoredDeckPresetId, storeSession } from "@/lib/session";

export interface ScenarioTestGame {
    /** Start a game on this scenario. No-op while another launch is running. */
    test: (row: Doc<"debugScenarios">) => void;
    /** The row currently being launched, if any — for a per-row busy label. */
    launchingId: string | null;
    /** Last failure, e.g. the one-active-game rule (#155) rejecting the create. */
    error: string | null;
    clearError: () => void;
}

export function useScenarioTestGame(): ScenarioTestGame {
    const user = useCurrentUser();
    const navigate = useNavigate();
    const presetDecks = useQuery(api.decks.list, {});
    const createSoloGame = useMutation(api.game.createSoloGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);

    const [launchingId, setLaunchingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const test = (row: Doc<"debugScenarios">) => {
        if (launchingId !== null || !user) return;
        // Point-free `.map(toPresetLobbyDeck)` would pass the array index
        // into the helper's optional banlist-override parameter.
        const decks = (presetDecks ?? []).map((d) => toPresetLobbyDeck(d));
        const storedId = getStoredDeckPresetId();
        const deck =
            decks.find((d) => d.presetId === storedId) ?? decks[0] ?? null;
        if (!deck) {
            setError("No deck available to start a scenario game with.");
            return;
        }

        setError(null);
        setLaunchingId(row._id);
        void (async () => {
            try {
                const gameId = await createSoloGame({
                    name: `Scenario: ${row.label}`,
                    deck: deckPayload(deck),
                    bestOf: 1,
                });
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
        })();
    };

    return {
        test,
        launchingId,
        error,
        clearError: () => setError(null),
    };
}
