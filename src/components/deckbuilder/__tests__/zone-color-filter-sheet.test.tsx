// The Zone colour filter sheet on coarse-pointer surfaces (issue #3678,
// ADR 0101 §2). Mounted through the real `DeckZoneSurface`; only the surface
// class is driven.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { createColumnLayout } from "@convex/deckLayout";
import type { SurfaceClass } from "~/hooks/useSurfaceClass";
import DeckZoneSurface, {
    type DeckZoneSurfaceProps,
} from "../deck-zone-surface";

const h = vi.hoisted(() => ({ surface: "roomy-fine" as SurfaceClass }));
vi.mock("~/hooks/useSurfaceClass", () => ({
    useSurfaceClass: () => h.surface,
}));

const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // red instant

function renderZone(props: Partial<DeckZoneSurfaceProps> = {}) {
    const base: DeckZoneSurfaceProps = {
        zone: "maindeck",
        title: "Maindeck",
        cards: [BOLT],
        layout: createColumnLayout(),
        onGroupingChange: () => {},
        onOrderingChange: () => {},
        dropModel: "columns",
        onCardClick: () => {},
        cardTitle: (card) => `Remove ${card.cardName} (drag to move zone)`,
        emptyMessage: "empty",
    };
    return render(
        <DragDropProvider>
            <DeckZoneSurface {...base} {...props} />
        </DragDropProvider>
    );
}

const trigger = (colours = "none") =>
    screen.getByRole("button", {
        name: `Maindeck colour filter: ${colours}`,
    });
const sheet = () =>
    screen.getByRole("dialog", { name: "Maindeck colour filter" });
const toggle = (c: string) =>
    within(sheet()).getByRole("button", { name: `Maindeck colour ${c}` });

beforeEach(() => {
    h.surface = "roomy-fine";
});

describe("Zone colour filter sheet", () => {
    it("keeps the inline toggles on a fine pointer", () => {
        renderZone();
        expect(
            screen.getByRole("button", { name: "Maindeck colour R" })
        ).toBeTruthy();
        expect(screen.queryByText("Colors")).toBeNull();
    });

    it.each(["phone", "roomy-coarse"] as const)(
        "%s: one Colors trigger, no inline toggles",
        (surface) => {
            h.surface = surface;
            renderZone();
            expect(trigger().textContent).toBe("Colors");
            expect(
                screen.queryByRole("button", { name: "Maindeck colour R" })
            ).toBeNull();
        }
    );

    it("toggling in the sheet filters the zone live and the trigger reflects it", () => {
        h.surface = "roomy-coarse";
        renderZone();
        fireEvent.click(trigger());
        const red = toggle("R");
        expect(red.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(red);
        expect(toggle("R").getAttribute("aria-pressed")).toBe("true");
        // Bolt is red: still shown; a blue filter hides it.
        fireEvent.click(toggle("R"));
        fireEvent.click(toggle("U"));
        expect(toggle("U").getAttribute("aria-pressed")).toBe("true");
        fireEvent.keyDown(document, { key: "Escape" });
        expect(trigger("U").textContent).not.toBe("Colors");
        expect(screen.queryByText("Lightning Bolt")).toBeNull();
    });

    it("renders no trigger where the Zone is not filterable", () => {
        h.surface = "phone";
        renderZone({ filterable: false });
        expect(screen.queryByText("Colors")).toBeNull();
    });
});
