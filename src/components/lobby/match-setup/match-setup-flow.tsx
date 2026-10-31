// The Constructed setup flow (PRD #5334, ADR 0153, issue #5340): loads the
// player's decks and the presets, holds the remembered setup, and turns Start
// into the one create/join mutation `startRequest` names. Every rule lives in
// `~/lib/matchSetup`; this component only wires it to Convex and storage.
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useStartMatch } from "~/hooks/useStartMatch";
import { useStartMatchPrefetch } from "~/hooks/useStartMatchPrefetch";
import { useUserDecks } from "~/hooks/useUserDecks";
import { toPresetLobbyDeck, type LobbyDeck } from "~/lib/deckTypes";
import {
    applyChange,
    loadSetup,
    reconcileSetup,
    saveSetup,
    startRequest,
    type MatchSetup,
} from "~/lib/matchSetup";
import LoadingScreen from "~/components/ui/loading-screen";
import ActiveGameNotice from "~/components/lobby/active-game-notice";
import MatchSetupPanes from "./match-setup-panes";

export default function MatchSetupFlow() {
    const user = useCurrentUser();
    const userDecks = useUserDecks();
    const presetDecks = useQuery(api.decks.list, {});
    const openGames = useQuery(api.gameReads.listOpenGames);
    // The server admits one active Match per user (`findActiveMatchForUser`)
    // and rejects every create/join while one stands, so the flow surfaces it
    // where Start is pressed — Resume or Concede it here — and blocks Start,
    // exactly as the lobby does (issue #7703).
    const activeGame = useQuery(api.gameReads.myActiveGame);
    const [stored, setStored] = useState<MatchSetup>(loadSetup);
    const { start, busy, error } = useStartMatch();
    useStartMatchPrefetch();

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

    const setup = reconcileSetup(stored, decks, openGames);
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

    return (
        <>
            {activeGame && (
                <ActiveGameNotice activeGame={activeGame} userId={user._id} />
            )}
            <MatchSetupPanes
                setup={setup}
                decks={decks}
                tables={openGames}
                onChange={update}
                canStart={request !== null && !activeGame}
                busy={busy}
                error={error}
                onStart={() => void start(setup, request, user._id)}
            />
        </>
    );
}
