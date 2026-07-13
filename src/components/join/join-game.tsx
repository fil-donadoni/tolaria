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
import AmbientPageGround from "~/components/ui/ambient-page-ground";
import DeckList from "~/components/lobby/deck-list";
import JoinAntechamberShell from "./join-antechamber-shell";

type JoinGameProps = {
    gameId: Id<"games">;
};

/** Invite antechamber (`/join/<gameId>`). Reached from a shared invite link
 *  instead of the lobby: it names the host, states the game's format, and lets
 *  the visitor pick a deck — from their own decks OR the presets, each shown in
 *  the lobby's deck panels and pre-filtered to that format (ADR 0036) — before
 *  being credited into the match. The host's decklist is never fetched here
 *  (`getJoinInfo` returns only join metadata, no cards). */
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

    // The visitor's own decks and the presets, each pre-filtered to the game's
    // format and kept in their own list (the two lobby deck panels).
    const eligibleUserDecks = useMemo<LobbyDeck[]>(
        () => (format ? filterDecksByFormat(userDecks ?? [], format) : []),
        [userDecks, format]
    );
    const eligiblePresetDecks = useMemo<LobbyDeck[]>(
        () =>
            format
                ? filterDecksByFormat(
                      (presetDecks ?? []).map((d) => toPresetLobbyDeck(d)),
                      format
                  )
                : [],
        [presetDecks, format]
    );

    const selectedDeck = useMemo(
        () =>
            selectPreset(
                [...eligibleUserDecks, ...eligiblePresetDecks],
                selectedId
            ),
        [eligibleUserDecks, eligiblePresetDecks, selectedId]
    );

    const backToLobby = () => void navigate({ to: "/" });

    // Select only legal decks (the row click); the DeckList "Select" button is
    // already disabled for illegal decks.
    const selectIfLegal = (decks: LobbyDeck[]) => (id: string) => {
        const d = decks.find((x) => x.presetId === id);
        if (d?.isLegal) setSelectedId(id);
    };

    const handleNewDeck = () =>
        void navigate({
            to: "/decks/create",
            search: format ? { format } : {},
        });

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
        <div className="relative min-h-dvh overflow-hidden bg-surface-base text-text">
            <AmbientPageGround ring />
            <div className="relative z-10 mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
                <Panel>
                    <PanelHeader
                        title="Join game"
                        subtitle={
                            <>
                                <span className="text-text">
                                    {info.hostName}
                                </span>{" "}
                                invited you · {formatLabel}
                            </>
                        }
                    />
                    <PanelBody className="items-center text-center">
                        <p className="text-sm text-text-muted">
                            Pick a deck to join. Only your {formatLabel} decks
                            are shown.
                        </p>
                    </PanelBody>
                </Panel>

                {error && (
                    <div className="rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Panel className="flex max-h-[28rem] flex-col">
                        <PanelHeader title="Your Decks" />
                        <PanelBody className="min-h-0 flex-1">
                            <div className="flex justify-end">
                                <button
                                    onClick={handleNewDeck}
                                    className="btn-base btn-tone-primary px-3 py-1.5 text-xs"
                                >
                                    + New Deck
                                </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                                <DeckList
                                    decks={eligibleUserDecks}
                                    selectedPresetId={selectedId}
                                    onFocus={selectIfLegal(eligibleUserDecks)}
                                    onSelect={setSelectedId}
                                    emptyLabel={`You have no ${formatLabel} deck. Create one to join.`}
                                />
                            </div>
                        </PanelBody>
                    </Panel>

                    <Panel className="flex max-h-[28rem] flex-col">
                        <PanelHeader title="Preset Decks" />
                        <PanelBody className="min-h-0 flex-1">
                            <div className="min-h-0 flex-1 overflow-auto">
                                <DeckList
                                    decks={eligiblePresetDecks}
                                    selectedPresetId={selectedId}
                                    onFocus={selectIfLegal(eligiblePresetDecks)}
                                    onSelect={setSelectedId}
                                    emptyLabel={`No ${formatLabel} preset decks.`}
                                />
                            </div>
                        </PanelBody>
                    </Panel>
                </div>

                <div className="flex justify-end gap-2">
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
                </div>
            </div>
        </div>
    );
}
