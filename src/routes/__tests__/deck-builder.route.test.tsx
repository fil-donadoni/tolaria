// /decks/$slug/edit routes by the deck's Format (ADR 0106): a `limited` deck
// opens in the pool deckbuilder over its own Deck Pool, every other deck in the
// constructed one. The row goes through the real `toUserLobbyDeck` reducer, and
// the query names are real, so the wiring from row to builder is what is proven.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DeckBuilderRoute from "../deck-builder.route";

const navigate = vi.fn();
const answers: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
    useParams: () => ({ slug: "deck-1" }),
    useSearch: () => ({}),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        decks: { getPreset: "getPreset" },
        userDecks: { get: "get", getDeckPool: "getDeckPool" },
    },
}));
vi.mock("convex/react", () => ({
    useQuery: (name: string, args: unknown) =>
        args === "skip" ? undefined : answers[name],
    useMutation: () => vi.fn(),
}));
vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => [],
    useUserDeckMutations: () => ({}),
    usePresetMutations: () => ({}),
}));
vi.mock("~/lib/fullCatalogue", () => ({ useFullCatalogue: () => null }));
vi.mock("~/components/lobby/deck-builder/deck-builder", () => ({
    default: () => <div>constructed builder</div>,
}));
vi.mock("~/components/deckbuilder/pool-deck-builder-form", () => ({
    default: (props: {
        detached?: boolean;
        pool: { cardName: string }[];
        existingDeck: { layout?: unknown };
    }) => (
        <div>
            pool builder{props.detached ? " detached" : ""} over{" "}
            {props.pool.map((c) => c.cardName).join()}{" "}
            {JSON.stringify(props.existingDeck.layout)}
        </div>
    ),
}));

const LAYOUT = { maindeck: { pins: { "0": { mv: "mv:6" } } } };

function row(format: string) {
    return {
        _id: "deck-1",
        name: "Deck",
        format,
        colors: [],
        cards: [],
        sideboard: [],
        layout: LAYOUT,
    };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    for (const key of Object.keys(answers)) delete answers[key];
});

describe("DeckBuilderRoute — the builder follows the deck's Format (ADR 0106)", () => {
    it("opens a limited deck in the detached pool builder over its Deck Pool and its row's layout", () => {
        answers.get = row("limited");
        answers.getDeckPool = [{ cardName: "Lightning Bolt" }];
        render(<DeckBuilderRoute mode="edit" />);
        expect(screen.getByText(/pool builder detached over/).textContent).toBe(
            `pool builder detached over Lightning Bolt ${JSON.stringify(LAYOUT)}`
        );
        expect(screen.queryByText("constructed builder")).toBeNull();
    });

    it("opens any other deck in the constructed builder", () => {
        answers.get = row("old-school");
        render(<DeckBuilderRoute mode="edit" />);
        expect(screen.getByText("constructed builder")).toBeTruthy();
        expect(screen.queryByText(/pool builder/)).toBeNull();
    });

    it("waits for the Deck Pool without offering the constructed builder", () => {
        answers.get = row("limited");
        render(<DeckBuilderRoute mode="edit" />);
        expect(screen.queryByText("constructed builder")).toBeNull();
        expect(screen.queryByText(/pool builder/)).toBeNull();
    });

    it("says so plainly when a limited deck has no Deck Pool, and leads back to it", () => {
        answers.get = row("limited");
        answers.getDeckPool = null;
        render(<DeckBuilderRoute mode="edit" />);
        expect(
            screen.getByText("This deck has no Pool to build from.")
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Back to deck" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/decks/$slug",
            params: { slug: "deck-1" },
        });
    });
});
