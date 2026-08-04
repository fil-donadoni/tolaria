// Unavailable Cards in the deck-builder results grid (ADR 0080, PRD #2023).
//
// A card the GRE does not implement is dimmed and unselectable in a REAL deck —
// it could not be played. In MANUAL mode no rule is enforced and every printed
// card is playable by construction, so the same card must stay selectable:
// gating on `entry.available` alone made the whole manual pool (~26k cards)
// pointer-events-none, i.e. a manual deck could not be built at all.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { CardIndexEntry } from "../useCardSearch";
import ResultCard from "../result-card";

// Leaf presentational children — irrelevant to the availability branch, and
// `DraggableCard` needs a dnd-kit provider we do not want in this test.
vi.mock("~/components/cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid="card-image" data-print-id={card.id} />
    ),
}));
vi.mock("../draggable-card", () => ({
    default: ({
        children,
        onClick,
        title,
    }: {
        children: React.ReactNode;
        onClick: () => void;
        title: string;
    }) => (
        <button data-testid="draggable" title={title} onClick={onClick}>
            {children}
        </button>
    ),
}));

function entry(available: boolean): CardIndexEntry {
    return {
        cardId: "print-1",
        name: "Sliver Queen",
        nameLower: "sliver queen",
        nameFold: "sliver queen",
        types: ["Creature"],
        subtypes: ["Sliver"],
        supertypes: ["Legendary"],
        colors: ["W", "U", "B", "R", "G"],
        manaValue: 7,
        oracleText: "",
        oracleFold: "",
        prints: [{ printId: "print-1", setCode: "STH" }],
        available,
    };
}

describe("ResultCard availability gating", () => {
    it("dims and blocks an Unavailable Card when availability is enforced", () => {
        const onAdd = vi.fn();
        const { queryByTestId, getByText } = render(
            <ResultCard
                entry={entry(false)}
                activeSets={[]}
                enforceAvailability
                onAdd={onAdd}
            />
        );
        expect(getByText("Unavailable")).toBeDefined();
        expect(queryByTestId("draggable")).toBeNull();
    });

    it("keeps an Unavailable Card selectable when availability is not enforced (manual mode)", () => {
        const onAdd = vi.fn();
        const { queryByText, getByTestId } = render(
            <ResultCard
                entry={entry(false)}
                activeSets={[]}
                enforceAvailability={false}
                onAdd={onAdd}
            />
        );
        expect(queryByText("Not yet available")).toBeNull();
        fireEvent.click(getByTestId("draggable"));
        expect(onAdd).toHaveBeenCalledWith("print-1", "Sliver Queen");
    });

    it("an available card is selectable either way", () => {
        for (const enforce of [true, false]) {
            const onAdd = vi.fn();
            const { getByTestId, unmount } = render(
                <ResultCard
                    entry={entry(true)}
                    activeSets={[]}
                    enforceAvailability={enforce}
                    onAdd={onAdd}
                />
            );
            fireEvent.click(getByTestId("draggable"));
            expect(onAdd).toHaveBeenCalledWith("print-1", "Sliver Queen");
            unmount();
        }
    });
});
