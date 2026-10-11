// "Split creatures" toggle + grid through the real surface (issue #5399).
import { beforeEach, describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { createColumnLayout } from "@convex/deckLayout";
import DeckZoneSurface from "../deck-zone-surface";

const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
};
const SERRA = {
    cardId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    cardName: "Serra Angel",
};

function mount() {
    return render(
        <DragDropProvider>
            <DeckZoneSurface
                zone="maindeck"
                title="Maindeck"
                cards={[BOLT, SERRA]}
                layout={createColumnLayout()}
                onGroupingChange={() => {}}
                onOrderingChange={() => {}}
                dropModel="columns"
                onCardClick={() => {}}
                cardTitle={(c) => `Remove ${c.cardName}`}
                emptyMessage="empty"
            />
        </DragDropProvider>
    );
}

describe("Split creatures toggle", () => {
    beforeEach(() => window.localStorage.clear());

    it("is off by default: no split grid", () => {
        const { container } = mount();
        expect(
            screen
                .getByRole("switch", { name: "Maindeck split creatures" })
                .getAttribute("aria-checked")
        ).toBe("false");
        expect(container.querySelector("[data-split-grid]")).toBeNull();
    });

    it("turns the grid on, and is remembered across a remount", () => {
        const first = mount();
        fireEvent.click(
            screen.getByRole("switch", { name: "Maindeck split creatures" })
        );
        expect(
            first.container.querySelector("[data-split-grid]")
        ).not.toBeNull();
        expect(
            first.container.querySelector("[data-split-divider]")
        ).not.toBeNull();
        first.unmount();
        const second = mount();
        expect(
            second.container.querySelector("[data-split-grid]")
        ).not.toBeNull();
    });
});
