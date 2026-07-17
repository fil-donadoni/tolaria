// PickRatingAdminPanel + PickRatingPanel wiring (PRD #1296 Slice C, issue
// #1300): `PickRatingAdminPanel` owns ONLY the admin gate (mirrors
// `BanlistAdminPanel`); `PickRatingPanel` — mounted only once the gate
// passes — owns scope selection and the query/mutation hooks, handing plain
// data + callbacks down to the presentational `PickRatingEditor` (its own
// dedicated test, `pick-rating-editor.test.tsx`, drives the real
// query-shape rendering). convex/react is mocked so this wiring — admin
// gate, scope switch, mutation argument threading, and the admin-gated
// query never even being CONSTRUCTED for a non-admin — is exercised without
// a live backend, mirroring `banlist-admin-panel.test.tsx`'s pattern.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PickRatingAdminPanel from "../pick-rating-admin-panel";

let currentUser: { isAdmin?: boolean } | null | undefined;
const setCardRating = vi.fn();
const clearCardRating = vi.fn();
const useQueryCalls: { name: string; args: unknown }[] = [];

const DRAFTABLE_SETS = [
    { setCode: "lea", draftable: true, missingCardCount: 0, sheets: [] },
    { setCode: "ice", draftable: false, missingCardCount: 50, sheets: [] },
    {
        setCode: "vintage-cube",
        draftable: true,
        missingCardCount: 0,
        sheets: [],
        isCube: true,
        availableCardCount: 283,
    },
];

const SCOPE_CARDS: Record<
    string,
    { cardId: string; name: string; dbRating: number | null; seedRating: number | null }[]
> = {
    lea: [
        { cardId: "black-lotus", name: "Black Lotus", dbRating: null, seedRating: 5 },
        { cardId: "circle-of-protection-red", name: "Circle of Protection: Red", dbRating: 1, seedRating: 1 },
    ],
    "vintage-cube": [
        { cardId: "sol-ring", name: "Sol Ring", dbRating: null, seedRating: 5 },
    ],
};

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }, args: unknown) => {
        useQueryCalls.push({ name: query._name, args });
        if (query._name === "listLimitedDraftableSets") return DRAFTABLE_SETS;
        if (query._name === "listScopeCardRatings") {
            if (args === "skip" || args === undefined) return undefined;
            return SCOPE_CARDS[(args as { scope: string }).scope] ?? [];
        }
        return undefined;
    },
    useMutation: (fn: { _name: string }) => {
        if (fn._name === "setCardRating") return setCardRating;
        if (fn._name === "clearCardRating") return clearCardRating;
        return vi.fn();
    },
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        limitedEvents: {
            listLimitedDraftableSets: { _name: "listLimitedDraftableSets" },
        },
        limited: {
            cardRatings: {
                listScopeCardRatings: { _name: "listScopeCardRatings" },
                setCardRating: { _name: "setCardRating" },
                clearCardRating: { _name: "clearCardRating" },
            },
        },
    },
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

describe("PickRatingAdminPanel (PRD #1296 Slice C, issue #1300)", () => {
    beforeEach(() => {
        currentUser = { isAdmin: true };
        setCardRating.mockReset().mockResolvedValue(null);
        clearCardRating.mockReset().mockResolvedValue(null);
        useQueryCalls.length = 0;
    });

    it("renders nothing for a non-admin user", () => {
        currentUser = { isAdmin: false };
        const { container } = render(<PickRatingAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing while the user is still loading (undefined)", () => {
        currentUser = undefined;
        const { container } = render(<PickRatingAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when signed out (null)", () => {
        currentUser = null;
        const { container } = render(<PickRatingAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("never even CONSTRUCTS the admin-gated card-ratings query for a non-admin (PickRatingPanel never mounts)", () => {
        currentUser = { isAdmin: false };
        render(<PickRatingAdminPanel />);
        expect(
            useQueryCalls.some((c) => c.name === "listScopeCardRatings")
        ).toBe(false);
        expect(
            useQueryCalls.some((c) => c.name === "listLimitedDraftableSets")
        ).toBe(false);
    });

    it("lists only DRAFTABLE scopes (LEA + Vintage Cube, not the below-floor ICE)", () => {
        render(<PickRatingAdminPanel />);
        expect(screen.getByRole("radio", { name: "LEA" })).toBeTruthy();
        expect(screen.getByRole("radio", { name: "Vintage Cube" })).toBeTruthy();
        expect(screen.queryByRole("radio", { name: "ICE" })).toBeNull();
    });

    it("defaults to the first draftable scope and shows its cards", () => {
        render(<PickRatingAdminPanel />);
        expect(screen.getByText("Black Lotus")).toBeTruthy();
        expect(screen.getByText("Circle of Protection: Red")).toBeTruthy();
    });

    it("switches the rendered cards when a different scope is selected", () => {
        render(<PickRatingAdminPanel />);
        expect(screen.getByText("Black Lotus")).toBeTruthy();

        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));

        expect(screen.getByText("Sol Ring")).toBeTruthy();
        expect(screen.queryByText("Black Lotus")).toBeNull();
    });

    it("submits setCardRating with the CURRENT scope + cardId + typed rating", async () => {
        render(<PickRatingAdminPanel />);
        const input = screen.getByLabelText("Rating for Black Lotus");
        fireEvent.change(input, { target: { value: "4" } });
        fireEvent.click(
            screen.getAllByText("Save")[0].closest("button")! /* Black Lotus row */
        );

        await waitFor(() =>
            expect(setCardRating).toHaveBeenCalledWith({
                scope: "lea",
                cardId: "black-lotus",
                rating: 4,
            })
        );
    });

    it("submits clearCardRating with the CURRENT scope + cardId for an overridden card", async () => {
        render(<PickRatingAdminPanel />);
        // Only Circle of Protection: Red has dbRating: 1 (an override) — its
        // Clear button is the only ENABLED one (Black Lotus's is disabled,
        // nothing to clear).
        const clearButtons = screen
            .getAllByText("Clear")
            .map((el) => el.closest("button") as HTMLButtonElement);
        const enabled = clearButtons.filter((b) => !b.disabled);
        expect(enabled).toHaveLength(1);
        fireEvent.click(enabled[0]);

        await waitFor(() =>
            expect(clearCardRating).toHaveBeenCalledWith({
                scope: "lea",
                cardId: "circle-of-protection-red",
            })
        );
    });

    it("submits mutations scoped to the Vintage Cube once it's selected", async () => {
        render(<PickRatingAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));

        const input = screen.getByLabelText("Rating for Sol Ring");
        fireEvent.change(input, { target: { value: "5" } });
        fireEvent.click(screen.getByText("Save").closest("button")!);

        await waitFor(() =>
            expect(setCardRating).toHaveBeenCalledWith({
                scope: "vintage-cube",
                cardId: "sol-ring",
                rating: 5,
            })
        );
    });
});
