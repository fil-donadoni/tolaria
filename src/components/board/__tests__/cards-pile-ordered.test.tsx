// Ordered pile fan (issue #9874): the graveyard's order is rules-relevant, so
// its dialog is one fan, bottom → top left to right, the top card chipped
// "Top", and the type filter keeps a filtered-out card's slot as a
// placeholder at its true position instead of dropping it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import {
    ORDERED_FAN_HIDDEN_STEP,
    ORDERED_FAN_OVERLAP,
} from "~/lib/ordered-pile";
import CardsPile from "../cards-pile";

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

afterEach(cleanup);

function typedCard(id: string, type: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
        types: [type],
    };
}

/** Bottom → top, the engine's graveyard order (last = top). */
const PILE = [
    typedCard("bolt-a", "Instant"),
    typedCard("bear-a", "Creature"),
    typedCard("bear-b", "Creature"),
    typedCard("bolt-b", "Instant"),
    typedCard("bear-c", "Creature"),
];

function renderOrdered(cards: CardInstance[] = PILE) {
    return render(
        <CardsPile
            cards={cards}
            layout="fan"
            ordered
            forceOpen
            title="Graveyard"
        />
    );
}

/** Every fan slot in DOM (= pile) order: a card tile, keyed by its card id,
 *  or a placeholder, keyed `hidden:<position>`. */
function slotSequence(root: HTMLElement): string[] {
    const row = root
        .querySelector(
            '[data-testid="card-image-bolt-a"], [data-ordered-pile-placeholder]'
        )
        ?.closest(".flex.mx-auto");
    return [...(row?.children ?? [])].map((el) => {
        const hidden = el.getAttribute("data-ordered-pile-placeholder");
        if (hidden) return `hidden:${hidden}`;
        const img = el.querySelector('[data-testid^="card-image-"]');
        return (
            img?.getAttribute("data-testid")?.slice("card-image-".length) ?? "?"
        );
    });
}

function slotElement(root: HTMLElement, key: string): HTMLElement {
    const row = root
        .querySelector(
            "[data-ordered-pile-placeholder], [data-testid^='card-image-']"
        )
        ?.closest(".flex.mx-auto");
    const el = [...(row?.children ?? [])].find((c) =>
        key.startsWith("hidden:")
            ? c.getAttribute("data-ordered-pile-placeholder") === key.slice(7)
            : c.querySelector(`[data-testid="card-image-${key}"]`)
    );
    if (!el) throw new Error(`no slot ${key}`);
    return el as HTMLElement;
}

describe("CardsPile — ordered pile fan (issue #9874)", () => {
    it("lays the pile out bottom → top and chips only the top card", () => {
        const { baseElement } = renderOrdered();
        expect(slotSequence(baseElement)).toEqual([
            "bolt-a",
            "bear-a",
            "bear-b",
            "bolt-b",
            "bear-c",
        ]);
        const chips = baseElement.querySelectorAll("[data-ordered-pile-top]");
        expect(chips).toHaveLength(1);
        expect(slotElement(baseElement, "bear-c").contains(chips[0])).toBe(
            true
        );
    });

    it("offers the type filter on the ordered fan (a plain fan has none)", () => {
        const { getByRole } = renderOrdered();
        expect(
            getByRole("radiogroup", { name: "Filter pile by card type" })
        ).toBeTruthy();
    });

    it("a filtered-out card keeps its slot as a placeholder at its true position", () => {
        const { baseElement, getByRole } = renderOrdered();
        fireEvent.click(getByRole("radio", { name: "Instants" }));
        expect(slotSequence(baseElement)).toEqual([
            "bolt-a",
            "hidden:4",
            "hidden:3",
            "bolt-b",
            "hidden:1",
        ]);
        // Placeholders are aria-hidden; one live count stands for them.
        expect(getByRole("status").textContent).toBe(
            "3 cards hidden by the filter"
        );
    });

    it("a hidden top card gets no Top chip — the trailing outline stands for it", () => {
        const { baseElement, getByRole } = renderOrdered();
        fireEvent.click(getByRole("radio", { name: "Instants" }));
        expect(baseElement.querySelector("[data-ordered-pile-top]")).toBeNull();
    });

    it("steps a card's width by the overlap, a placeholder's only by the hidden sliver", () => {
        const { baseElement, getByRole } = renderOrdered();
        fireEvent.click(getByRole("radio", { name: "Instants" }));
        const margin = (key: string) =>
            slotElement(baseElement, key).style.marginLeft;
        expect(margin("bolt-a")).toBe("calc(var(--pile-card-w) * 0)");
        // After a real card: the card overlap.
        expect(margin("hidden:4")).toBe(
            `calc(var(--pile-card-w) * -${ORDERED_FAN_OVERLAP})`
        );
        // After a placeholder: only the sliver shows.
        expect(margin("hidden:3")).toBe(
            `calc(var(--pile-card-w) * -${1 - ORDERED_FAN_HIDDEN_STEP})`
        );
        expect(margin("bolt-b")).toBe(
            `calc(var(--pile-card-w) * -${1 - ORDERED_FAN_HIDDEN_STEP})`
        );
    });

    it("ignores topOnRight: positions and the Top chip follow the pile's own order", () => {
        const { baseElement } = render(
            <CardsPile
                cards={PILE}
                layout="fan"
                ordered
                topOnRight
                forceOpen
                title="Graveyard"
            />
        );
        expect(slotSequence(baseElement)[4]).toBe("bear-c");
        const chip = baseElement.querySelector("[data-ordered-pile-top]");
        expect(slotElement(baseElement, "bear-c").contains(chip)).toBe(true);
    });
});
