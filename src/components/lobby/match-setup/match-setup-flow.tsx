// The Constructed setup flow (PRD #5334, ADR 0153, issue #5340): loads the
// player's decks and the presets, holds the remembered setup, and turns Start
// into the one create/join mutation `startRequest` names. Every rule lives in
// `~/lib/matchSetup`; this component only wires it to Convex and storage.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useUserDecks } from "~/hooks/useUserDecks";
import { toPresetLobbyDeck, type LobbyDeck } from "~/lib/deckTypes";
import {
    applyChange,
    loadSetup,
    saveSetup,
    startRequest,
    type MatchSetup,
    type StartRequest,
} from "~/lib/matchSetup";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import { storeDifficulty, storeSession } from "~/lib/session";
import LoadingScreen from "~/components/ui/loading-screen";
import MatchSetupPanes from "./match-setup-panes";

export default function MatchSetupFlow() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const userDecks = useUserDecks();
    const presetDecks = useQuery(api.decks.list, {});
    const [stored, setStored] = useState<MatchSetup>(loadSetup);
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

    const decks = useMemo<LobbyDeck[]>(
        () => [
            ...(userDecks ?? []),
            ...(presetDecks ?? []).map((d) => toPresetLobbyDeck(d)),
        ],
        [userDecks, presetDecks]
    );

    if (!user || userDecks === undefined || presetDecks === undefined) {
        return <LoadingScreen />;
    }

    // A remembered deck that was deleted or is no longer admitted is dropped
    // before it is ever shown (story 50).
    const setup = applyChange(stored, {}, decks);
    const request = startRequest(setup, decks, user.nickname);

    const update = (patch: Partial<MatchSetup>) => {
        const next = applyChange(setup, patch, decks);
        setStored(next);
        saveSetup(next);
    };

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
        }
    };

    const start = async () => {
        if (busy || !request) return;
        setBusy(true);
        setError(null);
        try {
            // The Bot reads its difficulty client-side (`useVsAiDriver`).
            if (setup.opponent === "bot") storeDifficulty(setup.difficulty);
            const gameId = await send(request);
            storeSession(
                gameId,
                request.seat === "p1" ? `${user._id}-p1` : user._id
            );
            void navigate({ to: "/game" });
        } catch (err) {
            setError(extractMutationErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <MatchSetupPanes
            setup={setup}
            decks={decks}
            onChange={update}
            canStart={request !== null}
            busy={busy}
            error={error}
            onStart={() => void start()}
        />
    );
}
