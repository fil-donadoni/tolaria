import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import AmbientPageGround from "~/components/ui/ambient-page-ground";
import { Button } from "~/components/ui/button";
import ErrorState from "~/components/ui/error-state";
import LoadingScreen from "~/components/ui/loading-screen";
import { Panel } from "~/components/ui/panel";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import PoolDeckBuilderForm from "./pool-deck-builder-form";

/**
 * A saved `limited` deck's builder outside its event (ADR 0106): it reads the
 * deck's own Deck Pool, so it works whether the event is running, closed or
 * deleted. No Seat is involved. The editor mounts only once the Pool has landed,
 * so its working deck can be seeded by a lazy `useState`.
 */
export default function DetachedPoolDeckBuilder({
    deck,
}: {
    deck: UserLobbyDeck;
}) {
    const navigate = useNavigate();
    const pool = useQuery(api.userDecks.getDeckPool, { id: deck.userDeckId });

    if (pool === undefined) {
        return <LoadingScreen message="Loading your Pool..." />;
    }

    if (pool === null) {
        return (
            <div className="relative flex min-h-full flex-col items-center justify-center bg-surface-base px-4 text-text">
                <SurfaceReadyMarker />
                <AmbientPageGround ring />
                <Panel className="relative z-10 w-full max-w-md">
                    <ErrorState
                        message="This deck has no Pool to build from."
                        action={
                            <Button
                                variant="secondary"
                                onClick={() =>
                                    void navigate({
                                        to: "/decks/$slug",
                                        params: { slug: deck.userDeckId },
                                    })
                                }
                            >
                                Back to deck
                            </Button>
                        }
                    />
                </Panel>
            </div>
        );
    }

    return (
        <>
            <SurfaceReadyMarker />
            <PoolDeckBuilderForm detached existingDeck={deck} pool={pool} />
        </>
    );
}
