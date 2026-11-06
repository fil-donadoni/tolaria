// `/limited/decks` (PRD #8407, issue #8409), through the real `useUserDecks`:
// the page is a view over the subscribed deck list, so a new list is a new
// render with no reload.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import LimitedDeckArchivePage from "../limited-deck-archive-page";

let listMine: unknown[] | undefined;

vi.mock("convex/react", async () => {
    const { getFunctionName } = await import("convex/server");
    return {
        useQuery: (ref: never) =>
            getFunctionName(ref).endsWith("listMine") ? listMine : undefined,
        useMutation: () => vi.fn(),
    };
});

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        params,
        children,
        ...rest
    }: {
        params: { slug: string };
        children: ReactNode;
    }) => (
        <a {...rest} href={`/decks/${params.slug}`}>
            {children}
        </a>
    ),
}));

function doc(id: string, extra: Record<string, unknown> = {}) {
    return {
        _id: id,
        name: id,
        format: "limited",
        colors: [],
        cards: Array.from({ length: 40 }, () => ({
            cardId: "c",
            cardName: "Mountain",
        })),
        sideboard: [],
        isLegal: true,
        reasons: [],
        ...extra,
    };
}

beforeEach(() => {
    listMine = [];
});
afterEach(cleanup);

describe("LimitedDeckArchivePage", () => {
    it("shows name, card count and legality, and opens the deck", () => {
        listMine = [
            doc("d1", { name: "Red Beats", limitedOrigin: "draft:lea" }),
        ];
        render(<LimitedDeckArchivePage />);

        expect(
            screen.getByRole("heading", { name: /Limited Edition Alpha Draft/ })
        ).toBeTruthy();
        const entry = screen.getByRole("link", { name: /Red Beats/ });
        expect(entry.getAttribute("href")).toBe("/decks/d1");
        expect(within(entry).getByText("40 cards")).toBeTruthy();
        expect(within(entry).getByText("Legal")).toBeTruthy();
    });

    it("spells out why a deck is illegal", () => {
        listMine = [
            doc("d1", {
                isLegal: false,
                reasons: [{ code: "too-few", message: "Fewer than 40 cards." }],
            }),
        ];
        render(<LimitedDeckArchivePage />);

        const entry = screen.getByRole("link", { name: /d1/ });
        expect(within(entry).getByText("Illegal")).toBeTruthy();
        expect(within(entry).getByText("Fewer than 40 cards.")).toBeTruthy();
    });

    it("reflects a rename and a deletion without a reload", () => {
        listMine = [doc("d1", { name: "Old" }), doc("d2", { name: "Doomed" })];
        const { rerender } = render(<LimitedDeckArchivePage />);
        expect(screen.getByRole("link", { name: /Old/ })).toBeTruthy();

        listMine = [doc("d1", { name: "New" })];
        rerender(<LimitedDeckArchivePage />);

        expect(screen.queryByRole("link", { name: /Old/ })).toBeNull();
        expect(screen.queryByRole("link", { name: /Doomed/ })).toBeNull();
        expect(screen.getByRole("link", { name: /New/ })).toBeTruthy();
    });

    it("says so when the player has no Limited deck", () => {
        listMine = [doc("constructed", { format: "freeform" })];
        render(<LimitedDeckArchivePage />);

        expect(screen.queryByRole("link")).toBeNull();
        expect(screen.getByText(/No Limited decks yet/)).toBeTruthy();
    });
});
