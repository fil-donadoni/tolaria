// `/admin/limited-decks` — origin groups (unclassified included) → an origin's
// decks with owner → a deck's full list (issue #8410).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import LimitedDeckArchivePanel from "../limited-deck-archive-panel";

const ORIGINS = [
    { origin: "sealed:lea", deckCount: 2 },
    { origin: null, deckCount: 1 },
];
const DECKS: Record<string, unknown[]> = {
    "sealed:lea": [
        {
            _id: "d1",
            name: "Red Beats",
            ownerNickname: "Alice",
            cardCount: 40,
            sideboardCount: 3,
            isLegal: true,
            reasons: [],
            createdAt: 1,
        },
    ],
    null: [],
};

vi.mock("convex/react", async () => {
    const { getFunctionName } = await import("convex/server");
    return {
        useQuery: (ref: never, args: { deckId?: string }) => {
            const name = getFunctionName(ref);
            if (name.endsWith("listLimitedOriginsAdmin")) return ORIGINS;
            return {
                _id: args.deckId,
                name: "Red Beats",
                ownerNickname: "Alice",
                limitedOrigin: "sealed:lea",
                cards: [
                    { cardId: "a", cardName: "Lightning Bolt" },
                    { cardId: "a", cardName: "Lightning Bolt" },
                ],
                sideboard: [],
                isLegal: true,
                reasons: [],
            };
        },
        usePaginatedQuery: (_ref: never, args: { origin: string | null }) => ({
            results: DECKS[String(args.origin)] ?? [],
            status: "Exhausted",
            loadMore: () => {},
        }),
    };
});

afterEach(cleanup);

describe("LimitedDeckArchivePanel", () => {
    it("lists origins with counts and the unclassified group", () => {
        render(<LimitedDeckArchivePanel />);
        expect(screen.getByText("Unclassified")).toBeTruthy();
        expect(screen.getByText("2")).toBeTruthy();
    });

    it("drills origin → deck → full card list", () => {
        render(<LimitedDeckArchivePanel />);
        fireEvent.click(screen.getByText("Unclassified"));
        expect(screen.getByText("No decks in this group")).toBeTruthy();

        fireEvent.click(screen.getByText(/Lea.*Sealed|Sealed/i));
        fireEvent.click(screen.getByText("Red Beats"));
        expect(screen.getByText("2 Lightning Bolt")).toBeTruthy();
        expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    });
});
