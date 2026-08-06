// The Limited builder's deck surface, rebuilt on the shared zone surface
// (issue #1622). Two jobs here:
//
//  1. **Limited sees NO behavioural change** — the fixed Lands + MV 0..7+
//     ladder, the per-column drop targets, the per-zone zoom sliders and the
//     `--card-base` floor are all exactly what they were before the rewire.
//  2. **The mounted drag test** the acceptance criteria require: a REAL drag
//     driven through the REAL surface, asserting the resulting Card Pin.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import { dragOnto, installDndJsdomShims } from "./dragHarness";
import {
    createDeckColumnLayout,
    makeColumnId,
    type DeckColumnLayout,
} from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import PoolDeckbuilderSurface from "../pool-deckbuilder-surface";

// Real registry ids — the engine resolves each card's column via the registry.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

function renderSurface(
    props: Partial<Parameters<typeof PoolDeckbuilderSurface>[0]> = {}
) {
    return render(
        <PoolDeckbuilderSurface
            mainCards={[]}
            sideCards={[]}
            layout={createDeckColumnLayout()}
            onMoveToSideboard={() => {}}
            onMoveToMaindeck={() => {}}
            onPin={() => {}}
            mainEmptyMessage="main empty"
            sideEmptyMessage="side empty"
            {...props}
        />
    );
}

describe("PoolDeckbuilderSurface (issue #1575, on the shared surface #1622)", () => {
    it("renders the Maindeck and Sideboard titles with live counts", () => {
        const { getByText } = renderSurface({
            mainCards: [card(BOLT_ID)],
            sideCards: [card(PLAINS_ID)],
        });
        expect(getByText(/Maindeck 1/)).toBeTruthy();
        expect(getByText(/Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("renders the full fixed Mana-Value column set in the Maindeck (every column a drop target)", () => {
        const { getByText, getAllByText } = renderSurface({
            mainCards: [card(BOLT_ID)],
            sideCards: [card(PLAINS_ID)],
        });
        expect(getByText("MV 7+")).toBeTruthy();
        expect(getAllByText("MV 1").length).toBe(1); // the Bolt column
        expect(getByText("MV 0")).toBeTruthy();
    });

    it("places a Maindeck card in the column its Card Pin names, not its auto column", () => {
        const layout: DeckColumnLayout = createDeckColumnLayout();
        layout.maindeck.pins = { [BOLT_ID]: { mv: makeColumnId("mv", "6") } };
        const { container } = renderSurface({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            layout,
        });
        const mv1 = container.querySelector('[data-column="mv:1"]')!;
        const mv6 = container.querySelector('[data-column="mv:6"]')!;
        expect(mv1.querySelectorAll("[role=button]")).toHaveLength(0);
        expect(mv6.querySelectorAll("[role=button]")).toHaveLength(1);
    });

    it("shows the empty-Maindeck hint while still rendering the columns as drop targets", () => {
        const { getByText } = renderSurface({
            mainEmptyMessage: "Move Pool cards here.",
            sideEmptyMessage: "Everything lives here until moved.",
        });
        expect(getByText("Move Pool cards here.")).toBeTruthy();
        expect(getByText("Everything lives here until moved.")).toBeTruthy();
        expect(getByText("MV 0")).toBeTruthy();
    });

    it("clicking a Maindeck card fires onMoveToSideboard with its id", () => {
        const onMoveToSideboard = vi.fn();
        const { getByTitle } = renderSurface({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            onMoveToSideboard,
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID);
    });

    it("clicking a Sideboard card fires onMoveToMaindeck with its id", () => {
        const onMoveToMaindeck = vi.fn();
        const { getByTitle } = renderSurface({
            sideCards: [card(PLAINS_ID, "Plains")],
            onMoveToMaindeck,
        });
        fireEvent.click(getByTitle(/Remove Plains/));
        expect(onMoveToMaindeck).toHaveBeenCalledWith(PLAINS_ID);
    });

    it("renders a per-zone zoom slider for both Maindeck and Sideboard", () => {
        const { getByLabelText } = renderSurface();
        expect(getByLabelText("Maindeck card size")).toBeTruthy();
        expect(getByLabelText("Sideboard card size")).toBeTruthy();
    });

    it("renders the draggable Maindeck/Sideboard split handle", () => {
        const { getByLabelText } = renderSurface();
        expect(getByLabelText("Resize Maindeck and Sideboard")).toBeTruthy();
    });

    it("groups the Sideboard into its non-empty Mana-Value columns, as before #1622", () => {
        const rendered = renderSurface({
            sideCards: [
                card(BOLT_ID, "Lightning Bolt"),
                card(PLAINS_ID, "Plains"),
            ],
        });
        // The Maindeck's nine columns always render; the Sideboard's do not —
        // scope the query to the Sideboard pane so the two don't mix.
        const labels = [
            ...sidePaneOf(rendered).querySelectorAll("[data-column]"),
        ].map((el) => el.querySelector("span")!.textContent);
        expect(labels).toEqual(["Lands", "MV 1"]);
    });
});

/** The Sideboard pane element — its header span's grandparent. The pane is
 *  the zone's single drop target under the `"pane"` drop model. */
function sidePaneOf(rendered: ReturnType<typeof renderSurface>): HTMLElement {
    return rendered.getByText(/Pool \(Sideboard\)/).parentElement!
        .parentElement!;
}

// Issue #2056 defect 1: the responsive card-size clamp must carry the
// CARD_MIN_W floor (via `cardBase()`), or a short-and-wide viewport (the
// `dvh` term binding) collapses tiles below legibility (measured 27.3px at
// 852x303). This asserts the emitted `--card-base` CSS var — the thing
// `--card-w`/`--card-h` are computed from — carries the floor, since jsdom
// can't measure a resolved pixel width.
describe("PoolDeckbuilderSurface — card-size floor (issue #2056)", () => {
    it("emits a --card-base custom property wrapped in a max() floor, not a bare min()", () => {
        const { container } = renderSurface();
        const surfaceRoot = container.firstElementChild as HTMLElement;
        const cardBase = surfaceRoot.style.getPropertyValue("--card-base");
        expect(cardBase).toContain("max(4.5rem");
        expect(cardBase.startsWith("min(")).toBe(false);
    });
});

// Issue #2275 acceptance criterion: "the card-size floor is unchanged — the
// fix is in how the shortfall is allocated." This is the regression guard for
// that promise: this component's own min-height stays exactly what it was,
// still deriving from the SAME unmodified `CARD_MIN_W` floor, so a future edit
// here can't silently re-introduce a second, disconnected floor.
describe("PoolDeckbuilderSurface — the pane floor itself is untouched by issue #2275", () => {
    it("still emits the same --card-base clamp as issue #2056 shipped — this component does not change the floor", () => {
        const { container } = renderSurface();
        const surfaceRoot = container.firstElementChild as HTMLElement;
        expect(surfaceRoot.style.getPropertyValue("--card-base")).toBe(
            "max(4.5rem, min(7.5rem, 17vw, 9dvh))"
        );
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The mounted drag test (issue #1622 AC: "a mounted test drives a drag through
// the real surface and asserts the resulting pin — a hand-built view does not
// count"). The Constructed half of the same AC lives in
// `lobby/deck-builder/__tests__/deck-builder-zones.test.tsx`; both drive the
// drag through the shared `dragHarness` — see its header for why the drag goes
// through dnd-kit's own manager rather than synthetic pointer events.
// ────────────────────────────────────────────────────────────────────────────

beforeAll(installDndJsdomShims);

describe("PoolDeckbuilderSurface — mounted drag (issue #1622)", () => {
    it("dragging a Maindeck card onto another column records that column's Card Pin", async () => {
        const manager = new DragDropManager();
        const onPin = vi.fn();
        const { getByTitle, container } = renderSurface({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            onPin,
            manager,
        });

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="mv:6"]')!
        );

        expect(onPin).toHaveBeenCalledWith(BOLT_ID, "mv:6");
    });

    it("dragging a Sideboard card onto a Maindeck column moves it in AND pins it, in one gesture", async () => {
        const manager = new DragDropManager();
        const onPin = vi.fn();
        const onMoveToMaindeck = vi.fn();
        const { getByTitle, container } = renderSurface({
            sideCards: [card(BOLT_ID, "Lightning Bolt")],
            onPin,
            onMoveToMaindeck,
            manager,
        });

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="mv:lands"]')!
        );

        expect(onMoveToMaindeck).toHaveBeenCalledWith(BOLT_ID);
        expect(onPin).toHaveBeenCalledWith(BOLT_ID, "mv:lands");
    });

    it("dragging a Maindeck card onto the Sideboard moves it out of the deck, with no pin", async () => {
        const manager = new DragDropManager();
        const onPin = vi.fn();
        const onMoveToSideboard = vi.fn();
        const rendered = renderSurface({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            sideCards: [card(PLAINS_ID, "Plains")],
            onPin,
            onMoveToSideboard,
            manager,
        });

        // The Sideboard PANE is the drop target under the `"pane"` model.
        await dragOnto(
            manager,
            rendered.getByTitle(/Remove Lightning Bolt/),
            sidePaneOf(rendered)
        );

        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID);
        expect(onPin).not.toHaveBeenCalled();
    });
});
