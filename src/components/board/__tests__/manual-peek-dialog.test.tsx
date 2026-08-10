// The library peek dialog (manual-mode QA round 3, item 2).
//
// "Peek top N…" shipped as a LOG-ONLY verb: it wrote "looks at top N" and
// showed the peeking player nothing, which reads as a broken menu item. The
// dialog is the missing half, and the thing worth pinning is WHERE its cards
// come from: a dedicated `getManualLibraryTop` query, because the projected
// state renders the library as `{ count }` for everyone and must keep doing
// so — library order is private until a player takes the action that looks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import type { ProjectedManualCard } from "@convex/manual";
import type { CardInstance } from "~/types/game";
import {
    ManualCardInteractionProvider,
    manualVerbsForZone,
} from "~/lib/manual-card-verbs";
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
    useQuery: (ref: unknown, args: unknown) => useQuery(ref, args),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { getManualLibraryTop: { _name: "getManualLibraryTop" } } },
}));
vi.mock("@convex/cards", () => ({
    tryGetDefinition: () => undefined,
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    FACE_DOWN_CARD_ID: "__faceDownDef",
}));

const { default: ManualPeekDialog } = await import("../manual-peek-dialog");

function card(id: string, name: string): ProjectedManualCard {
    return {
        id,
        card: { id: `print-${id}` },
        name,
        zone: "library",
        controllerId: "me",
        ownerId: "me",
        isTapped: false,
    };
}

beforeEach(cleanup);
beforeEach(() => useQuery.mockReset());

describe("the Manual Game library peek dialog", () => {
    it("renders nothing, and asks the server nothing, while no peek is open", () => {
        useQuery.mockReturnValue(undefined);
        render(
            <ManualPeekDialog
                gameId={"game-id" as never}
                request={null}
                onClose={vi.fn()}
            />
        );
        expect(document.body.textContent).toBe("");
        // "skip", not a real arg object — an idle board must not subscribe to
        // another seat's library order.
        expect(useQuery.mock.calls[0]?.[1]).toBe("skip");
    });

    it("lists the top N as art only — one tile per card, no captions", () => {
        useQuery.mockReturnValue({
            cards: [card("a", "Black Lotus"), card("b", "Ancestral Recall")],
            libraryCount: 37,
        });
        render(
            <ManualPeekDialog
                gameId={"game-id" as never}
                request={{
                    playerId: "me",
                    playerName: "Alice",
                    n: 2,
                    nonce: 1,
                }}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText("Top 2 of Alice's library")).toBeTruthy();
        expect(document.querySelectorAll("li")).toHaveLength(2);
        // Art only: the card image carries the name, so no caption is
        // rendered under a tile.
        expect(screen.queryByText("Black Lotus")).toBeNull();
        // `GameDialog` renders its subtitle twice (visible + the a11y
        // description), so this asserts presence, not uniqueness.
        expect(
            screen.getAllByText("2 shown · 37 in library").length
        ).toBeGreaterThan(0);
    });

    it("a depthless request (Peek all) queries the whole library", () => {
        useQuery.mockReturnValue({ cards: [], libraryCount: 0 });
        render(
            <ManualPeekDialog
                gameId={"game-id" as never}
                request={{ playerId: "opp", playerName: "Bob", nonce: 2 }}
                onClose={vi.fn()}
            />
        );
        expect(useQuery.mock.calls[0][1]).toEqual({
            gameId: "game-id",
            playerId: "opp",
            n: undefined,
        });
        expect(screen.getByText("Bob's library")).toBeTruthy();
        expect(screen.getByText("The library is empty.")).toBeTruthy();
    });
});

// The peek tiles are interactive, like every other pile card: a library card
// is reachable without milling down to it.
describe("peek tiles carry the manual card menu", () => {
    it("opens the LIBRARY verb list for the clicked card and dispatches through the injected interaction", () => {
        useQuery.mockReturnValue({
            cards: [card("a", "Black Lotus")],
            libraryCount: 1,
        });
        const activate = vi.fn();
        render(
            <ManualCardInteractionProvider
                value={{
                    getVerbs: (c: CardInstance) =>
                        manualVerbsForZone(c as unknown as ProjectedManualCard),
                    activate,
                }}
            >
                <ManualPeekDialog
                    gameId={"game-id" as never}
                    request={{
                        playerId: "me",
                        playerName: "Alice",
                        nonce: 1,
                    }}
                    onClose={vi.fn()}
                />
            </ManualCardInteractionProvider>
        );

        fireEvent.click(
            document.querySelector<HTMLElement>("[data-manual-card-menu]")!
        );
        // A library card can go anywhere but back to the library.
        expect(screen.getByText("Put onto battlefield")).toBeTruthy();
        expect(screen.getByText("Move to hand")).toBeTruthy();
        expect(screen.queryByText("Move to library (top)")).toBeNull();

        fireEvent.click(screen.getByText("Move to hand"));
        expect(activate).toHaveBeenCalledWith(
            expect.objectContaining({ id: "a" }),
            "move:hand"
        );
    });

    it("renders no menu chrome at all with no interaction injected (every GRE surface)", () => {
        useQuery.mockReturnValue({
            cards: [card("a", "Black Lotus")],
            libraryCount: 1,
        });
        render(
            <ManualPeekDialog
                gameId={"game-id" as never}
                request={{ playerId: "me", playerName: "Alice", nonce: 1 }}
                onClose={vi.fn()}
            />
        );
        expect(document.querySelector("[data-manual-card-menu]")).toBeNull();
    });
});
