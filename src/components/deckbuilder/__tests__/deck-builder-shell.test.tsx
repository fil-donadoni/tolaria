// `DeckBuilderShell` — the ONE deckbuilder screen (ADR 0075 §1, issue #1623).
//
// This file is the successor of `pool-deckbuilder-surface.test.tsx`: the
// Limited builder's own surface component was absorbed by the shell, so its
// assertions moved here rather than being retired. Three jobs:
//
//  1. **Neither builder sees a behavioural change** — the fixed Lands + MV
//     0..7+ ladder, the per-column drop targets, the per-zone zoom sliders and
//     the draggable split are all exactly what they were.
//  2. **The mounted drag test** (issue #1622 AC): a REAL drag driven through
//     the REAL surface, asserting the resulting Card Pin.
//  3. **The shell's own slot vocabulary** (issue #1623 AC "the shell never
//     branches on which builder am I"): each region appears when — and only
//     when — its slot/prop was supplied, which is what makes the third
//     declared variant (the draft-time Pool, ADR 0075 §6) expressible without
//     reopening the shell.
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
import { cardBase } from "~/lib/cardSizing";
import DeckBuilderShell, {
    type DeckBuilderShellProps,
} from "../deck-builder-shell";
import type {
    DeckBuilderViewSpec,
    DeckZoneActions,
} from "../deckBuilderVariant";

// Real registry ids — the engine resolves each card's column via the registry.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

/** The Limited variant's declared view spec (its own localStorage keys). */
const VIEW: DeckBuilderViewSpec = {
    cardBase: cardBase("7.5rem", "17vw", "9dvh"),
    splitZone: "pool",
    splitDefault: 2 / 3,
    mainZoomZone: "pool-main",
    sideZoomZone: "pool-side",
    zoomInitial: 1.0,
};

const NO_ACTIONS: DeckZoneActions = {
    onMoveToSideboard: () => {},
    onMoveToMaindeck: () => {},
    onPin: () => {},
    onMainCardClick: () => {},
    onSideCardClick: () => {},
};

function renderShell(
    props: Omit<Partial<DeckBuilderShellProps>, "actions"> & {
        actions?: Partial<DeckZoneActions>;
    } = {}
) {
    const { actions, ...rest } = props;
    return render(
        <DeckBuilderShell
            title="Build Limited Deck"
            backLabel="← Back to Event"
            onDone={() => {}}
            mainCards={[]}
            sideCards={[]}
            layout={createDeckColumnLayout()}
            view={VIEW}
            zones={{
                sideTitle: "Pool (Sideboard)",
                mainEmptyMessage: "main empty",
                sideEmptyMessage: "side empty",
            }}
            {...rest}
            actions={{ ...NO_ACTIONS, ...actions }}
        />
    );
}

describe("DeckBuilderShell — zones (issue #1575, on the shared surface #1622)", () => {
    it("renders the Maindeck and Sideboard titles with live counts", () => {
        const { getByText } = renderShell({
            mainCards: [card(BOLT_ID)],
            sideCards: [card(PLAINS_ID)],
        });
        expect(getByText(/Maindeck 1/)).toBeTruthy();
        expect(getByText(/Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("renders the full fixed Mana-Value column set in the Maindeck (every column a drop target)", () => {
        const { getByText, getAllByText } = renderShell({
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
        const { container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            layout,
        });
        const mv1 = container.querySelector('[data-column="mv:1"]')!;
        const mv6 = container.querySelector('[data-column="mv:6"]')!;
        expect(mv1.querySelectorAll("[role=button]")).toHaveLength(0);
        expect(mv6.querySelectorAll("[role=button]")).toHaveLength(1);
    });

    it("shows the empty-Maindeck hint while still rendering the columns as drop targets", () => {
        const { getByText } = renderShell({
            zones: {
                sideTitle: "Pool (Sideboard)",
                mainEmptyMessage: "Move Pool cards here.",
                sideEmptyMessage: "Everything lives here until moved.",
            },
        });
        expect(getByText("Move Pool cards here.")).toBeTruthy();
        expect(getByText("Everything lives here until moved.")).toBeTruthy();
        expect(getByText("MV 0")).toBeTruthy();
    });

    it("clicking a Maindeck card fires onMainCardClick with the card", () => {
        const onMainCardClick = vi.fn();
        const { getByTitle } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMainCardClick },
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onMainCardClick).toHaveBeenCalledWith(
            card(BOLT_ID, "Lightning Bolt")
        );
    });

    it("clicking a Sideboard card fires onSideCardClick with the card", () => {
        const onSideCardClick = vi.fn();
        const { getByTitle } = renderShell({
            sideCards: [card(PLAINS_ID, "Plains")],
            actions: { onSideCardClick },
        });
        fireEvent.click(getByTitle(/Remove Plains/));
        expect(onSideCardClick).toHaveBeenCalledWith(card(PLAINS_ID, "Plains"));
    });

    it("renders a per-zone zoom slider for both Maindeck and Sideboard", () => {
        const { getByLabelText } = renderShell();
        expect(getByLabelText("Maindeck card size")).toBeTruthy();
        expect(getByLabelText("Sideboard card size")).toBeTruthy();
    });

    it("renders the draggable Maindeck/Sideboard split handle", () => {
        const { getByLabelText } = renderShell();
        expect(getByLabelText("Resize Maindeck and Sideboard")).toBeTruthy();
    });

    it("groups the Sideboard into its non-empty Mana-Value columns, as before #1622", () => {
        const rendered = renderShell({
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
function sidePaneOf(rendered: ReturnType<typeof renderShell>): HTMLElement {
    return rendered.getByText(/Pool \(Sideboard\)/).parentElement!
        .parentElement!;
}

// ────────────────────────────────────────────────────────────────────────────
// Issue #1623 AC: "the shell never branches on 'which builder am I' — every
// difference arrives as a slot or a prop." What that buys is checked here: the
// shell is driven purely by slot/prop PRESENCE, so the third declared variant
// (the draft-time Pool, ADR 0075 §6 — no source panel, no legality panel, no
// save bar, a reduced header bar) is already expressible.
// ────────────────────────────────────────────────────────────────────────────
describe("DeckBuilderShell — declared-variant vocabulary (issue #1623)", () => {
    it("renders no source-panel region when the slot is absent, and renders it when supplied", () => {
        const without = renderShell();
        expect(without.queryByTestId("source")).toBeNull();
        const withPanel = renderShell({
            sourcePanel: <div data-testid="source">results</div>,
        });
        expect(withPanel.getByTestId("source")).toBeTruthy();
    });

    it("renders the legality panel only when a legality record is supplied", () => {
        expect(renderShell().container.querySelector('[role="status"]')).toBe(
            null
        );
        const { container } = renderShell({
            legality: { formatLabel: "Limited", isLegal: true, reasons: [] },
        });
        expect(container.querySelector('[role="status"]')).toBeTruthy();
    });

    it("renders the save bar only when a save-bar record is supplied", () => {
        expect(renderShell().container.querySelector("form")).toBe(null);
        const { container } = renderShell({
            saveBar: { name: "Deck", cardCount: 0, onChangeName: () => {} },
        });
        expect(container.querySelector("form")).toBeTruthy();
    });

    it("hides the header band under short-viewport when it carries nothing but Back + title, and compacts it instead once it carries controls", () => {
        // The rule is derived from SLOT PRESENCE, never from the caller's
        // identity: a band carrying only Back + title can hide (SaveDeckBar
        // reproduces both), a band carrying search/Format/filters cannot
        // without taking those controls off screen with it.
        const bare = renderShell().container.querySelector(
            "[data-deckbuilder-header]"
        )!;
        expect(bare.className.split(/\s+/)).toContain("short-viewport:hidden");

        const withControls = renderShell({
            headerActions: <button type="button">Import</button>,
        }).container.querySelector("[data-deckbuilder-header]")!;
        const classes = withControls.className.split(/\s+/);
        expect(classes).not.toContain("short-viewport:hidden");
        expect(classes).toContain("short-viewport:py-1");
    });

    it("carries the Sideboard cap only when the variant declares one — Limited's Sideboard stays uncapped", () => {
        const uncapped = renderShell({ sideCards: [card(PLAINS_ID)] });
        expect(uncapped.getByText(/^Pool \(Sideboard\) 1$/)).toBeTruthy();

        const capped = renderShell({
            sideCards: [card(PLAINS_ID)],
            zones: {
                sideTitle: "Sideboard",
                mainEmptyMessage: "m",
                sideEmptyMessage: "s",
                sideCountSuffix: "/15",
                sideWarning: "over limit",
            },
        });
        expect(capped.getByText(/^Sideboard 1\/15$/)).toBeTruthy();
        expect(capped.getByText("over limit")).toBeTruthy();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The mounted drag test (issue #1622 AC: "a mounted test drives a drag through
// the real surface and asserts the resulting pin — a hand-built view does not
// count"). The whole-wrapper halves of the same AC live in
// `deck-builder-parity.test.tsx`; all of them drive the drag through the
// shared `dragHarness` — see its header for why the drag goes through
// dnd-kit's own manager rather than synthetic pointer events.
// ────────────────────────────────────────────────────────────────────────────

beforeAll(installDndJsdomShims);

describe("DeckBuilderShell — mounted drag (issue #1622)", () => {
    it("dragging a Maindeck card onto another column records that column's Card Pin", async () => {
        const manager = new DragDropManager();
        const onPin = vi.fn();
        const { getByTitle, container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onPin },
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
        const { getByTitle, container } = renderShell({
            sideCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onPin, onMoveToMaindeck },
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
        const rendered = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            sideCards: [card(PLAINS_ID, "Plains")],
            actions: { onPin, onMoveToSideboard },
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
