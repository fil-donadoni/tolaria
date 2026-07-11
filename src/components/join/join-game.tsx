import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { FORMAT_RULES, type FormatId } from "@convex/formats";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useUserDecks } from "~/hooks/useUserDecks";
import {
    deckPayload,
    filterDecksByFormat,
    selectPreset,
    toPresetLobbyDeck,
    type LobbyDeck,
} from "~/lib/deckTypes";
import { storeSession } from "~/lib/session";
import {
    Panel,
    PanelHeader,
    PanelBody,
    PanelFooter,
} from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import LoadingScreen from "~/components/ui/loading-screen";
import DeckList from "~/components/lobby/deck-list";
import JoinAntechamberShell from "./join-antechamber-shell";

type JoinGameProps = {
    gameId: Id<"games">;
};

/** Invite antechamber (`/join/<gameId>`). Reached from a shared invite link
 *  instead of the lobby: it names the host, states the game's format, and lets
 *  the visitor pick a deck (their own + presets) pre-filtered to that format
 *  before being credited into the match. The host's decklist is never fetched
 *  here — `getJoinInfo` returns only join metadata (no cards). */
export default function JoinGame({ gameId }: JoinGameProps) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const info = useQuery(api.game.getJoinInfo, { gameId });
    const presetDecks = useQuery(api.decks.list, {});
    const userDecks = useUserDecks();
    const joinGame = useMutation(api.game.joinGame);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const format = info?.format as FormatId | undefined;

    // Decks the visitor may bring, pre-filtered to the game's format (ADR 0036).
    const eligibleDecks = useMemo<LobbyDeck[]>(() => {
        if (!format) return [];
        const all: LobbyDeck[] = [
            ...(userDecks ?? []),
            ...(presetDecks ?? []).map(toPresetLobbyDeck),
        ];
        return filterDecksByFormat(all, format);
    }, [userDecks, presetDecks, format]);

    const selectedDeck = useMemo(
        () => selectPreset(eligibleDecks, selectedId),
        [eligibleDecks, selectedId]
    );

    const backToLobby = () => void navigate({ to: "/" });

    const handleJoin = async () => {
        if (isBusy || !user || !selectedDeck || !selectedDeck.isLegal) return;
        setIsBusy(true);
        setError(null);
        try {
            await joinGame({ gameId, deck: deckPayload(selectedDeck) });
            storeSession(gameId, user._id);
            void navigate({ to: "/game" });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to join the game."
            );
            setIsBusy(false);
        }
    };

    if (info === undefined) return <LoadingScreen message="Loading game…" />;

    // Not joinable: unknown id, already started/full, or the caller's own game.
    if (info === null || !info.joinable) {
        const reason =
            info === null
                ? "This game no longer exists."
                : info.isHost
                  ? "This is your own game — open it from the lobby."
                  : info.status !== "waiting"
                    ? "This game has already started."
                    : "This game is full.";
        return (
            <JoinAntechamberShell>
                <Panel className="relative z-10 w-full max-w-sm">
                    <PanelHeader title="Can’t join game" />
                    <PanelBody className="items-center text-center">
                        <p className="text-sm text-text-muted">{reason}</p>
                    </PanelBody>
                    <PanelFooter className="justify-center">
                        <Button variant="secondary" onClick={backToLobby}>
                            Back to lobby
                        </Button>
                    </PanelFooter>
                </Panel>
            </JoinAntechamberShell>
        );
    }

    const formatLabel = format ? FORMAT_RULES[format].label : "";

    return (
        <JoinAntechamberShell>
            <Panel className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col">
                <PanelHeader
                    title="Join game"
                    subtitle={
                        <>
                            <span className="text-text">{info.hostName}</span>{" "}
                            invited you · {formatLabel}
                        </>
                    }
                />
                <PanelBody className="min-h-0 flex-1">
                    <p className="text-sm text-text-muted">
                        Pick a deck to join. Only your {formatLabel} decks are
                        shown.
                    </p>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <DeckList
                            decks={eligibleDecks}
                            selectedPresetId={selectedId}
                            onFocus={(id) => {
                                const d = eligibleDecks.find(
                                    (x) => x.presetId === id
                                );
                                if (d?.isLegal) setSelectedId(id);
                            }}
                            onSelect={setSelectedId}
                            emptyLabel={`You have no legal ${formatLabel} deck. Build one from the lobby first.`}
                        />
                    </div>
                    {error && (
                        <p className="rounded-sm border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
                            {error}
                        </p>
                    )}
                </PanelBody>
                <PanelFooter>
                    <Button variant="secondary" onClick={backToLobby}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleJoin}
                        disabled={
                            isBusy || !selectedDeck || !selectedDeck.isLegal
                        }
                    >
                        {isBusy ? "Joining…" : "Join game"}
                    </Button>
                </PanelFooter>
            </Panel>
        </JoinAntechamberShell>
    );
}
