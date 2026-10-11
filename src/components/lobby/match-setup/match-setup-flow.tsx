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
    const openGames = useQuery(api.gameReads.listOpenGames);
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
    const joinGameByCode = useMutation(api.game.joinGameByCode);

    const decks = useMemo<LobbyDeck[]>(
        () => [
            ...(userDecks ?? []),
            ...(presetDecks ?? []).map((d) => toPresetLobbyDeck(d)),
        ],
        [userDecks, presetDecks]
    );

    if (
        !user ||
        userDecks === undefined ||
        presetDecks === undefined ||
        openGames === undefined
    ) {
        return <LoadingScreen />;
    }

    // A remembered deck that was deleted or is no longer admitted is dropped
    // before it is ever shown (story 50).
    const reconciled = applyChange(stored, {}, decks);
    // A remembered table that closed since (or filled, or was cancelled) is
    // dropped too, so the recap never offers a seat that is gone.
    const setup =
        reconciled.joinTableId !== null &&
        !openGames.some((t) => t._id === reconciled.joinTableId)
            ? applyChange(
                  reconciled,
                  { joinTableId: null, joinTableFormat: null },
                  decks
              )
            : reconciled;
    const request = startRequest(setup, decks, user.nickname);

    // `imported` is a deck the strict import just saved: it is admitted here
    // before the reactive deck list delivers its row (a stored id that is
    // briefly unknown is dropped only from the view, never from `stored`).
    const update = (patch: Partial<MatchSetup>, imported?: LobbyDeck) => {
        const next = applyChange(
            setup,
            patch,
            imported ? [...decks, imported] : decks
        );
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
            case "joinGameByCode":
                return (await joinGameByCode(req.args)).gameId;
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
            tables={openGames}
            onChange={update}
            canStart={request !== null}
            busy={busy}
            error={error}
            onStart={() => void start()}
        />
    );
}
