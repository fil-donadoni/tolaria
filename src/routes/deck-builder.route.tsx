import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import DeckBuilder from "~/components/lobby/deck-builder/deck-builder";
import { useUserDecks } from "~/hooks/useUserDecks";
import { toUserLobbyDeck } from "~/lib/deckTypes";

interface DeckBuilderRouteProps {
    mode: "create" | "edit";
}

export default function DeckBuilderRoute({ mode }: DeckBuilderRouteProps) {
    const navigate = useNavigate();
    const params = useParams({ strict: false }) as { slug?: string };
    const slug = mode === "edit" ? params.slug : undefined;

    const userDecks = useUserDecks();
    const editingDeck = useQuery(
        api.userDecks.get,
        slug ? { id: slug as Id<"userDecks"> } : "skip"
    );

    if (mode === "edit") {
        if (editingDeck === undefined || userDecks === undefined) {
            return (
                <div className="flex h-screen items-center justify-center text-white">
                    Loading...
                </div>
            );
        }
        if (editingDeck === null) {
            return (
                <div className="flex h-screen flex-col items-center justify-center gap-4 text-white">
                    <p>Deck not found.</p>
                    <button
                        onClick={() => void navigate({ to: "/" })}
                        className="rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
                    >
                        Back to lobby
                    </button>
                </div>
            );
        }
        return (
            <DeckBuilder
                initialDeck={toUserLobbyDeck(editingDeck)}
                initialDeckList={userDecks}
                onClose={(savedId) => {
                    if (savedId) {
                        void navigate({
                            to: "/decks/$slug",
                            params: { slug: savedId },
                        });
                    } else {
                        void navigate({ to: "/" });
                    }
                }}
            />
        );
    }

    if (userDecks === undefined) {
        return (
            <div className="flex h-screen items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    return (
        <DeckBuilder
            initialDeck={null}
            initialDeckList={userDecks}
            onClose={(savedId) => {
                if (savedId) {
                    void navigate({
                        to: "/decks/$slug",
                        params: { slug: savedId },
                    });
                } else {
                    void navigate({ to: "/" });
                }
            }}
        />
    );
}
