import { useNavigate, useParams } from "@tanstack/react-router";
import DeckBuilder from "~/components/lobby/deck-builder/deck-builder";
import { getUserDeck, isUserDeckId } from "~/lib/userDecks";

interface DeckBuilderRouteProps {
    mode: "create" | "edit";
}

export default function DeckBuilderRoute({ mode }: DeckBuilderRouteProps) {
    const navigate = useNavigate();
    const params = useParams({ strict: false }) as { slug?: string };
    const slug = mode === "edit" ? params.slug : undefined;

    if (mode === "edit" && slug) {
        if (!isUserDeckId(slug)) {
            void navigate({
                to: "/decks/$slug",
                params: { slug },
                replace: true,
            });
            return null;
        }
        const deck = getUserDeck(slug);
        if (!deck) {
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
                initialDeck={deck}
                onClose={(savedPresetId) => {
                    if (savedPresetId) {
                        void navigate({
                            to: "/decks/$slug",
                            params: { slug: savedPresetId },
                        });
                    } else {
                        void navigate({ to: "/" });
                    }
                }}
            />
        );
    }

    return (
        <DeckBuilder
            initialDeck={null}
            onClose={(savedPresetId) => {
                if (savedPresetId) {
                    void navigate({
                        to: "/decks/$slug",
                        params: { slug: savedPresetId },
                    });
                } else {
                    void navigate({ to: "/" });
                }
            }}
        />
    );
}
