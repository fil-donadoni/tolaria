// The lobby home (PRD #5334 stories 1–14 and 58, issue #5344): Last Match,
// Play (Constructed · Limited), Your Tables and Decks, in that order. Every
// choice of a match lives in the setup flow (`/play/constructed`); the home
// only replays the remembered setup, opens the flow, and browses.
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useStartMatch } from "~/hooks/useStartMatch";
import { useUserDecks } from "~/hooks/useUserDecks";
import { useMyCurrentLimitedEvents } from "~/hooks/useLimitedEvent";
import { toPresetLobbyDeck, type LobbyDeck } from "~/lib/deckTypes";
import { lastMatchView, yourTables, type TableRow } from "~/lib/lobbyHome";
import { loadSetup, reconcileSetup, startRequest } from "~/lib/matchSetup";
import { storeSession, type DeckFormatFilter } from "~/lib/session";
import { LOBBY_BG } from "~/components/ui/ambient-backgrounds";
import { Banner } from "~/components/ui/banner";
import LoadingScreen from "~/components/ui/loading-screen";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import LobbyFooter from "~/components/legal/lobby-footer";
import { cn } from "~/lib/utils";
import ActiveGameNotice from "./active-game-notice";
import HomeArtCard from "./home-art-card";
import HomeDecksSection from "./home-decks-section";
import LastMatchTile from "./last-match-tile";
import LobbyBackground from "./lobby-background";
import YourTablesSection from "./your-tables-section";

/** The two Play tiles' art: local lobby frames, deterministic offline. */
const PLAY_ART = { constructed: LOBBY_BG[4], limited: LOBBY_BG[5] } as const;

function Lobby() {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const pageVisible = usePageVisible();
    const userDecks = useUserDecks();
    const presetDecks = useQuery(api.decks.list, pageVisible ? {} : "skip");
    const openGames = useQuery(
        api.gameReads.listOpenGames,
        pageVisible ? {} : "skip"
    );
    // #155: a user holds at most one active game; the notice resumes or
    // abandons it, Your Tables lists it.
    const activeGame = useQuery(
        api.gameReads.myActiveGame,
        pageVisible ? {} : "skip"
    );
    const myLimitedEvents = useMyCurrentLimitedEvents();
    const { start, busy, error } = useStartMatch();

    const decks = useMemo<LobbyDeck[]>(
        () => [
            ...(userDecks ?? []),
            ...(presetDecks ?? []).map((d) => toPresetLobbyDeck(d)),
        ],
        [userDecks, presetDecks]
    );

    if (
        presetDecks === undefined ||
        userDecks === undefined ||
        openGames === undefined ||
        user === undefined ||
        myLimitedEvents === undefined
    ) {
        return <LoadingScreen />;
    }

    // The flow's own remembered setup, reconciled exactly as the flow does,
    // so "Play again" sends what Start would.
    const setup = reconcileSetup(loadSetup(), decks, openGames);
    const lastMatch = lastMatchView(setup, decks);
    const tables = yourTables(activeGame ?? null, myLimitedEvents);

    const openFlow = () => void navigate({ to: "/play/constructed" });
    const playAgain = () => {
        if (!user) return;
        void start(setup, startRequest(setup, decks, user.nickname), user._id);
    };
    const openTable = (row: TableRow) => {
        if (row.kind === "event") {
            void navigate({
                to: "/limited/$eventId",
                params: { eventId: row.eventId },
            });
            return;
        }
        if (!user) return;
        storeSession(
            row.gameId,
            row.seat === "p1" ? `${user._id}-p1` : user._id
        );
        void navigate({ to: "/game" });
    };
    const newDeck = (format: DeckFormatFilter) =>
        void navigate({
            to: "/decks/create",
            // "All" seeds nothing: the builder falls back to its default.
            search: format === "all" ? {} : { format },
        });

    // Constructed and Limited take the half Last Match leaves; with no Last
    // Match to show, they share the whole row.
    const playTile = cn(
        "h-36 md:row-span-2 md:h-auto",
        !lastMatch && "md:col-span-2"
    );

    return (
        // NO `overflow-hidden` here (issue #2274): this root is a flex ITEM
        // of the shell's scrolling `<main>`, and hiding its overflow would
        // drop its `min-height: auto` floor and CLIP a home taller than the
        // viewport instead of letting `<main>` scroll to its footer.
        // `min-h-full` is the claim — the shell's remainder as a floor.
        // `shell-height-claims.guard.test.tsx` re-derives this className.
        <div className="relative min-h-full bg-surface-base text-text">
            <SurfaceReadyMarker />
            <LobbyBackground />
            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4">
                {activeGame && user && (
                    <ActiveGameNotice
                        activeGame={activeGame}
                        userId={user._id}
                    />
                )}
                {error && <Banner tone="danger">{error}</Banner>}

                <div className="grid grid-cols-2 gap-3 md:auto-rows-[9rem] md:grid-cols-4">
                    {lastMatch && (
                        <LastMatchTile
                            view={lastMatch}
                            onPlayAgain={playAgain}
                            onChangeSetup={openFlow}
                            busy={busy}
                            blocked={!!activeGame}
                            className="col-span-2 h-[240px] md:row-span-2 md:h-auto"
                        />
                    )}
                    {/* `contents`: the Play tiles are cells of the same grid
                        as Last Match, the wrapper only names the section. */}
                    <div data-home-section="play" className="contents">
                        <HomeArtCard
                            art={{ image: PLAY_ART.constructed }}
                            chip="Play"
                            title="Constructed"
                            line="vs Bot · Solo · Human"
                            titleClass="text-2xl md:text-3xl"
                            className={playTile}
                            onClick={openFlow}
                            seam={{ "data-home-play": "constructed" }}
                        />
                        <HomeArtCard
                            art={{ image: PLAY_ART.limited }}
                            chip="Play"
                            title="Limited"
                            line="Sealed · Draft events"
                            titleClass="text-2xl md:text-3xl"
                            className={playTile}
                            onClick={() => void navigate({ to: "/limited" })}
                            seam={{ "data-home-play": "limited" }}
                        />
                    </div>
                </div>

                <YourTablesSection rows={tables} onOpen={openTable} />

                <HomeDecksSection
                    decks={decks}
                    onOpen={(presetId) =>
                        void navigate({
                            to: "/decks/$slug",
                            params: { slug: presetId },
                        })
                    }
                    onNew={newDeck}
                />

                <LobbyFooter />
            </div>
        </div>
    );
}

export default Lobby;
