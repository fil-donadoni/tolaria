import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import AttachedCardsCluster from "../attached-cards-cluster";

// Stub card art (registry + image loader) — a marker div carrying the instance
// id so we can assert which cards the pile dialog reveals.
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid={`card-image-${card.id}`} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("~/hooks/useInertialScroll", () => ({
    useInertialScroll: () => ({ current: null }),
}));

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
    };
}

const member = (c: CardInstance) => <div data-testid={`member-${c.id}`} />;

describe("AttachedCardsCluster — corner peek-stack + pile dialog", () => {
    it("renders nothing when there are no attached cards", () => {
        const { container } = render(
            <AttachedCardsCluster
                cards={[]}
                renderMember={member}
                interactiveMembers
                pileTitle="Attached"
            />
        );
        expect(container.querySelector("button")).toBeNull();
    });

    it("shows a ×N badge with the true count (even beyond the peek cap)", () => {
        const cards = Array.from({ length: 7 }, (_, i) => makeCard(`a${i}`));
        const { getByText } = render(
            <AttachedCardsCluster
                cards={cards}
                renderMember={member}
                interactiveMembers
                pileTitle="Attached"
            />
        );
        // Badge reflects all 7 though only a few slivers are painted.
        expect(getByText("×7")).toBeTruthy();
    });

    it("opens the pile dialog with EVERY attached card on badge click", () => {
        const cards = [makeCard("x1"), makeCard("x2"), makeCard("x3")];
        const { getByText, baseElement } = render(
            <AttachedCardsCluster
                cards={cards}
                renderMember={member}
                interactiveMembers
                pileTitle="Attached to Serra Angel"
            />
        );
        fireEvent.click(getByText("×3"));
        // All three cards revealed in the dialog (grid layout).
        expect(
            within(baseElement).getAllByText(/Attached to Serra Angel/).length
        ).toBeGreaterThan(0);
        expect(
            baseElement.querySelector('[data-testid="card-image-x1"]')
        ).toBeTruthy();
        expect(
            baseElement.querySelector('[data-testid="card-image-x2"]')
        ).toBeTruthy();
        expect(
            baseElement.querySelector('[data-testid="card-image-x3"]')
        ).toBeTruthy();
    });

    it("passive members (exile-held art) open the dialog when a sliver is clicked", () => {
        const cards = [makeCard("e1"), makeCard("e2")];
        const { baseElement, getAllByRole } = render(
            <AttachedCardsCluster
                cards={cards}
                renderMember={member}
                interactiveMembers={false}
                pileTitle="Held in exile"
            />
        );
        // Slivers are wrapped in open-the-pile buttons (plus the badge button).
        const openers = getAllByRole("button", { name: /open pile/ });
        expect(openers.length).toBeGreaterThan(1);
        fireEvent.click(openers[0]);
        // Dialog revealed both exile-held cards.
        expect(
            baseElement.querySelector('[data-testid="card-image-e1"]')
        ).toBeTruthy();
        expect(
            baseElement.querySelector('[data-testid="card-image-e2"]')
        ).toBeTruthy();
    });

    it("prints the per-card 'Attached to: X' caption in the pile dialog", () => {
        // The dialog TITLE names the cluster's host, but with an Aura on an
        // Aura (Power Leak on Holy Strength) the members do NOT all enchant
        // that host — each card must state its OWN host in words.
        const cards = [makeCard("holy"), makeCard("leak")];
        const hosts: Record<string, string> = {
            holy: "Grizzly Bears",
            leak: "Holy Strength",
        };
        const { getByText, baseElement } = render(
            <AttachedCardsCluster
                cards={cards}
                renderMember={member}
                interactiveMembers
                pileTitle="Attached to Grizzly Bears"
                pileCaptionFor={(c) => `Attached to: ${hosts[c.id]}`}
            />
        );
        fireEvent.click(getByText("×2"));
        expect(
            within(baseElement).getByText("Attached to: Grizzly Bears")
        ).toBeTruthy();
        expect(
            within(baseElement).getByText("Attached to: Holy Strength")
        ).toBeTruthy();
    });

    it("interactive members (auras) do NOT wrap the sliver in a pile-opening button", () => {
        const cards = [makeCard("au1"), makeCard("au2")];
        const { getAllByRole } = render(
            <AttachedCardsCluster
                cards={cards}
                renderMember={member}
                interactiveMembers
                pileTitle="Attached"
            />
        );
        // Only the ×N badge opens the pile; the aura slivers keep their own
        // board click (rendered by renderMember, no wrapper button).
        expect(getAllByRole("button", { name: /open pile/ })).toHaveLength(1);
    });
});
