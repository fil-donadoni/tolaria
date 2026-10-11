// Send one setup's Start request and enter the game (PRD #5334, issues #5340
// and #5344). Shared by the setup flow's Start and the home's "Play again",
// so both send exactly the mutation `startRequest` names.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MatchSetup, StartRequest } from "~/lib/matchSetup";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import { storeDifficulty, storeSession } from "~/lib/session";

export function useStartMatch() {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const createGame = useMutation(api.game.createGame);
    const createSoloGame = useMutation(api.game.createSoloGame);
    const createManualGame = useMutation(api.gameManual.createManualGame);
    const createManualSoloGame = useMutation(
        api.gameManual.createManualSoloGame
    );
    const joinGame = useMutation(api.game.joinGame);
    const joinManualGame = useMutation(api.gameManual.joinManualGame);
    const joinGameByCode = useMutation(api.game.joinGameByCode);

    const send = async (req: StartRequest): Promise<Id<"games">> => {
        switch (req.mutation) {
            case "createGame":
                return createGame(req.args);
            case "createSoloGame":
                return createSoloGame(req.args);
            case "createManualGame":
                return createManualGame(req.args);
            case "createManualSoloGame":
                return createManualSoloGame(req.args);
            case "joinGame":
                await joinGame(req.args);
                return req.args.gameId;
            case "joinManualGame":
                await joinManualGame(req.args);
                return req.args.gameId;
            case "joinGameByCode":
                return (await joinGameByCode(req.args)).gameId;
        }
    };

    const start = async (
        setup: MatchSetup,
        request: StartRequest | null,
        userId: Id<"users">
    ) => {
        if (busy || !request) return;
        setBusy(true);
        setError(null);
        try {
            // The Bot reads its difficulty client-side (`useVsAiDriver`).
            if (setup.opponent === "bot") storeDifficulty(setup.difficulty);
            const gameId = await send(request);
            storeSession(
                gameId,
                request.seat === "p1" ? `${userId}-p1` : userId
            );
            void navigate({ to: "/game" });
        } catch (err) {
            setError(extractMutationErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return { start, busy, error };
}
