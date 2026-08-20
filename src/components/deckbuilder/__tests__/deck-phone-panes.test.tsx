// Issue #2584 — the deckbuilder on a phone: three full-page snap panes with
// tabs that are drop targets, the deck as MV rows with duplicates collapsed,
// the Peek Panel as the primary move path, and a bottom bar in place of
// `SaveDeckBar`.
//
// Everything here runs through the REAL `DeckBuilderShell` — the whole point
// of the AC ("dom tests through the real zone surface for tab drop, row move,
// peek CTA"). happy-dom has no layout, so what it CAN prove is which elements
// exist, which drop id each one registers, and which callback a gesture
// reaches; the pixel half (panes actually snapping, rows actually scrolling
// without flipping the pane) is the five-viewport browser receipt in the PR.
//
// The viewport is driven through `vi.mock` rather than through happy-dom's
// media queries, the pattern `compact-chrome.test.tsx` established: the branch
// under test must be decided by the test, not by an environment that evaluates
// no media query.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { DOUBLE_CLICK_WINDOW_MS } from "~/lib/gesture/activation";
import { DragDropManager } from "@dnd-kit/dom";
import { createDeckColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import { cardBase } from "~/lib/cardSizing";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { dragOnto, installDndJsdomShims } from "./dragHarness";
import DeckBuilderShell, {
    type DeckBuilderShellProps,
} from "../deck-builder-shell";
import type {
    DeckBuilderViewSpec,
    DeckZoneActions,
} from "../deckBuilderVariant";

let mode: ViewportMode = "portrait";
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => mode,
}));

beforeAll(installDndJsdomShims);
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mode = "portrait";
});

/** A REAL pointer click sequence. A browser delivers a double-click as
 *  click(detail 1), click(detail 2), dblclick — `fireEvent.doubleClick` alone
 *  synthesises none of the preceding clicks, which is why the shipped guard
 *  never saw the two removals the sequence caused (PR #2641 review, blocker
 *  1). Everything here goes through the events a browser actually sends. */
function doubleClickLikeABrowser(el: Element) {
    fireEvent.click(el, { detail: 1 });
    fireEvent.click(el, { detail: 2 });
    fireEvent.doubleClick(el, { detail: 2 });
}

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

const VIEW: DeckBuilderViewSpec = {
    cardBase: cardBase("7.5rem", "17vw", "9dvh"),
    splitZone: "phone-test",
    splitDefault: 2 / 3,
    mainZoomZone: "phone-test-main",
    sideZoomZone: "phone-test-side",
    zoomInitial: 1.0,
};

const NO_ACTIONS: DeckZoneActions = {
    onMoveToSideboard: () => {},
    onMoveToMaindeck: () => {},
    onPin: () => {},
    onMainCardClick: () => {},
    onSideCardClick: () => {},
    onMainGroupingChange: () => {},
    onSideGroupingChange: () => {},
    onMainOrderingChange: () => {},
    onSideOrderingChange: () => {},
};

function renderShell(
    props: Omit<Partial<DeckBuilderShellProps>, "actions"> & {
        actions?: Partial<DeckZoneActions>;
    } = {}
) {
    const { actions, ...rest } = props;
    return render(
        <DeckBuilderShell
            title="Edit Deck"
            onDone={() => {}}
            mainCards={[]}
            sideCards={[]}
            layout={createDeckColumnLayout()}
            view={VIEW}
            zones={{
                mainEmptyMessage: "main empty",
                sideEmptyMessage: "side empty",
            }}
            {...rest}
            actions={{ ...NO_ACTIONS, ...actions }}
        />
    );
}

const SOURCE_PANE = {
    label: "Search",
    count: 3,
    content: <div data-testid="results">results</div>,
};

function tabLabels(): string[] {
    return [...document.querySelectorAll("[data-deck-pane-tab]")].map(
        (el) => el.textContent ?? ""
    );
}

// ────────────────────────────────────────────────────────────────────────────
// AC 1 — "at 390x844 the three panes snap, each tab accepts a drop, the
// sideboard is reachable by swipe and by tab".
// ────────────────────────────────────────────────────────────────────────────
describe("DeckBuilderShell — the phone pane strip (issue #2584)", () => {
    it("renders one tab per pane the variant supplied — THREE with a source panel, TWO without", () => {
        renderShell({
            sourcePanel: SOURCE_PANE,
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            sideCards: [card(PLAINS_ID, "Plains"), card(BOLT_ID, "Bolt")],
        });
        expect(tabLabels()).toEqual(["Search3", "Main1", "Side2"]);

        cleanup();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            zones: {
                mainTabLabel: "Deck",
                sideTabLabel: "Pool",
                mainEmptyMessage: "m",
                sideEmptyMessage: "s",
            },
        });
        expect(tabLabels()).toEqual(["Deck1", "Pool0"]);
    });

    it("lays the panes out as a horizontal snap-scroller, each pane one viewport wide", () => {
        const { container } = renderShell({
            sourcePanel: SOURCE_PANE,
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
        });
        const strip = container.querySelector(
            '[data-deck-pane="source"]'
        )!.parentElement!;
        expect(strip.className.split(/\s+/)).toEqual(
            expect.arrayContaining([
                "snap-x",
                "snap-mandatory",
                "overflow-x-auto",
            ])
        );
        for (const id of ["source", "maindeck", "sideboard"]) {
            const pane = container.querySelector(`[data-deck-pane="${id}"]`)!;
            expect(pane.className.split(/\s+/)).toEqual(
                expect.arrayContaining(["w-full", "shrink-0", "snap-start"])
            );
        }
    });

    it("collapses to the pre-#2584 layout on a desktop viewport — no tabs, no strip box, no bottom bar", () => {
        mode = "desktop";
        const { container } = renderShell({
            sourcePanel: SOURCE_PANE,
            saveBar: { name: "Deck", cardCount: 0, onChangeName: () => {} },
        });
        expect(container.querySelector("[data-deck-pane-tabs]")).toBeNull();
        expect(container.querySelector("[data-deck-bottom-bar]")).toBeNull();
        // The strip wrapper is `display: contents`, so the source pane's
        // parent is the scroll wrapper it has always been.
        const strip = container.querySelector(
            '[data-deck-pane="source"]'
        )!.parentElement!;
        expect(strip.className).toContain("contents");
        // `SaveDeckBar` is back.
        expect(container.querySelector("form")).toBeTruthy();
    });

    it("dropping a Maindeck card on the SIDEBOARD TAB moves it out of the deck", async () => {
        const manager = new DragDropManager();
        const onMoveToSideboard = vi.fn();
        const { getByTitle, container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMoveToSideboard },
            manager,
        });

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-deck-pane-tab="sideboard"]')!
        );

        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
    });

    it("dropping a Sideboard card on the MAINDECK TAB moves it into the deck, with no Pin (the tab names no Column)", async () => {
        const manager = new DragDropManager();
        const onMoveToMaindeck = vi.fn();
        const onPin = vi.fn();
        const { getByTitle, container } = renderShell({
            sideCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMoveToMaindeck, onPin },
            manager,
        });

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-deck-pane-tab="maindeck"]')!
        );

        expect(onMoveToMaindeck).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
        expect(onPin).not.toHaveBeenCalled();
    });

    it("dropping a Maindeck card on the SOURCE TAB removes it from the deck altogether", async () => {
        const manager = new DragDropManager();
        const onRemoveFromDeck = vi.fn();
        const { getByTitle, container } = renderShell({
            sourcePanel: SOURCE_PANE,
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onRemoveFromDeck },
            manager,
        });

        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-deck-pane-tab="source"]')!
        );

        expect(onRemoveFromDeck).toHaveBeenCalledWith(
            BOLT_ID,
            "maindeck",
            BOLT_ID
        );
    });
});

// ────────────────────────────────────────────────────────────────────────────
// AC 2 — "MV rows collapse duplicates to one tile xN; select/move acts on one
// copy; a row swipe never flips the pane".
// ────────────────────────────────────────────────────────────────────────────
describe("DeckBuilderShell — MV rows in portrait (issue #2584)", () => {
    it("draws each Column as a row and collapses four copies into one tile with a x4 badge", () => {
        const { container } = renderShell({
            mainCards: Array.from({ length: 4 }, () =>
                card(BOLT_ID, "Lightning Bolt")
            ),
        });
        const row = container.querySelector(
            '[data-deck-row][data-column="mv:1"]'
        )!;
        expect(row).toBeTruthy();
        expect(row.querySelectorAll("[role=button][title]")).toHaveLength(1);
        expect(row.querySelector("[data-card-count]")!.textContent).toBe("x4");
    });

    it("contains a row's horizontal overscroll so a row swipe never flips the pane", () => {
        const { container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
        });
        const scroller = container.querySelector(
            '[data-deck-row][data-column="mv:1"]'
        )!.lastElementChild!;
        expect(scroller.className.split(/\s+/)).toEqual(
            expect.arrayContaining(["overflow-x-auto", "overscroll-x-contain"])
        );
    });

    it("goes back to pile columns in landscape — the same Columns, the other arrangement", () => {
        mode = "landscape-compact";
        const { container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
        });
        expect(container.querySelector("[data-deck-row]")).toBeNull();
        expect(container.querySelector('[data-column="mv:1"]')).toBeTruthy();
        // …and the tabs are still there: a tab is the only drop target that
        // can reach a pane the player is not looking at.
        expect(container.querySelector("[data-deck-pane-tabs]")).toBeTruthy();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// AC — "tapping a card opens the Peek Panel (→ Side / → Pool / Move to… /
// Inspect, the likeliest destination primary)" and "per-card overlay buttons
// are gone at every viewport".
// ────────────────────────────────────────────────────────────────────────────
describe("DeckBuilderShell — the Peek Panel as the move path (issue #2584)", () => {
    it("tapping a Maindeck card opens the panel with `→ Side` primary, and the CTA moves exactly that copy", () => {
        const onMoveToSideboard = vi.fn();
        const onMainCardClick = vi.fn();
        const { getAllByTitle } = renderShell({
            mainCards: [
                card(BOLT_ID, "Lightning Bolt"),
                card(BOLT_ID, "Lightning Bolt"),
            ],
            actions: { onMoveToSideboard, onMainCardClick },
        });

        // Duplicates are collapsed, so the row shows ONE tile standing for two
        // copies — tapping it must act on one copy, not both.
        fireEvent.click(getAllByTitle(/Remove Lightning Bolt/)[0]);
        // The tap SELECTS; it never fires the old move-on-click handler.
        expect(onMainCardClick).not.toHaveBeenCalled();

        const cta = screen.getByRole("button", { name: "→ Side" });
        fireEvent.click(cta);
        expect(onMoveToSideboard).toHaveBeenCalledTimes(1);
        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
    });

    it("labels the primary CTA with the variant's own zone name — `→ Pool` for a Limited build", () => {
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            zones: {
                mainTabLabel: "Deck",
                sideTabLabel: "Pool",
                mainEmptyMessage: "m",
                sideEmptyMessage: "s",
            },
        });
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/));
        expect(screen.getByRole("button", { name: "→ Pool" })).toBeTruthy();
    });

    it("a Sideboard card's primary CTA points the other way", () => {
        const onMoveToMaindeck = vi.fn();
        renderShell({
            sideCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMoveToMaindeck },
        });
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/));
        fireEvent.click(screen.getByRole("button", { name: "→ Main" }));
        expect(onMoveToMaindeck).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
    });

    it("offers `Move to…`, and picking a Column pins the tapped copy through the SAME seam a drag uses", () => {
        const onPin = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onPin },
        });
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/));
        fireEvent.click(screen.getByRole("button", { name: "Move to…" }));
        // Scope to the sheet: "MV 6" is also the label of the row behind it.
        const sheet = document.querySelector("[data-action-sheet]")!;
        fireEvent.click(
            [...sheet.querySelectorAll("button")].find(
                (el) => el.textContent === "MV 6"
            )!
        );
        expect(onPin).toHaveBeenCalledWith(BOLT_ID, "mv:6", BOLT_ID);
    });

    it("offers `★ Featured` only where the variant declares the affordance", () => {
        const onSet = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            featured: { cardId: null, onSet },
        });
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/));
        fireEvent.click(screen.getByRole("button", { name: "★ Featured" }));
        expect(onSet).toHaveBeenCalledWith(BOLT_ID);

        cleanup();
        renderShell({ mainCards: [card(BOLT_ID, "Lightning Bolt")] });
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/));
        expect(screen.queryByRole("button", { name: "★ Featured" })).toBeNull();
    });

    it("keeps click-to-move on a desktop viewport — the panel is the TOUCH path, not a replacement", () => {
        mode = "desktop";
        const onMainCardClick = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMainCardClick },
        });
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/));
        expect(onMainCardClick).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "→ Side" })).toBeNull();
    });

    it("a double-click opens the Inspect Overlay at every viewport — the pointer path to the card read", () => {
        mode = "desktop";
        renderShell({ mainCards: [card(BOLT_ID, "Lightning Bolt")] });
        fireEvent.doubleClick(screen.getByTitle(/Remove Lightning Bolt/));
        expect(document.querySelector("[data-inspect-overlay]")).toBeTruthy();
    });

    it("a REAL double-click destroys nothing — the click pair never reaches the move handler", () => {
        // PR #2641 review, blocker 1: the browser's click,click,dblclick left
        // `onMainCardClick` (Constructed: remove a copy from the deck) called
        // TWICE before the overlay opened — silent data loss on the primary
        // desktop gesture.
        mode = "desktop";
        const onMainCardClick = vi.fn();
        renderShell({
            mainCards: [
                card(BOLT_ID, "Lightning Bolt"),
                card(BOLT_ID, "Lightning Bolt"),
            ],
            actions: { onMainCardClick },
        });

        vi.useFakeTimers();
        doubleClickLikeABrowser(
            screen.getAllByTitle(/Remove Lightning Bolt/)[0]
        );
        // …and still nothing once the deferred single click's window has
        // elapsed: the `dblclick` CANCELLED it, it is not merely pending.
        vi.advanceTimersByTime(DOUBLE_CLICK_WINDOW_MS * 2);

        expect(onMainCardClick).not.toHaveBeenCalled();
        expect(document.querySelector("[data-inspect-overlay]")).toBeTruthy();
    });

    it("a lone pointer click still moves the card, once the double-click window has passed", () => {
        // The other half of the guard above: deferring must not silently kill
        // the desktop click-to-move gesture this slice was to leave unchanged.
        mode = "desktop";
        const onMainCardClick = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMainCardClick },
        });

        vi.useFakeTimers();
        fireEvent.click(screen.getByTitle(/Remove Lightning Bolt/), {
            detail: 1,
        });
        vi.advanceTimersByTime(DOUBLE_CLICK_WINDOW_MS + 1);
        expect(onMainCardClick).toHaveBeenCalledTimes(1);
    });

    it("reaches `★ Featured` through the Inspect Overlay at a POINTER viewport — a mouse has no other path to it", () => {
        // PR #2641 review, blocker 2: `featured-card-button.tsx` is deleted and
        // the replacement CTA lived in the TOUCH-only selection's action set,
        // so on desktop/tablet the overlay opened with `actions={[]}` and PRD
        // #589's Featured Card was unreachable at every pointer viewport.
        mode = "desktop";
        const onSet = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            featured: { cardId: null, onSet },
        });

        doubleClickLikeABrowser(screen.getByTitle(/Remove Lightning Bolt/));
        const overlay = document.querySelector("[data-inspect-overlay]")!;
        expect(overlay).toBeTruthy();
        const featured = [...overlay.querySelectorAll("button")].find(
            (el) => el.textContent === "★ Featured"
        )!;
        expect(featured).toBeTruthy();
        fireEvent.click(featured);
        expect(onSet).toHaveBeenCalledWith(BOLT_ID);
        // Firing a CTA closes the overlay — a read of a card the player just
        // acted on is not what they are looking at any more.
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
    });

    it("offers the move CTA in the overlay too, on the copy that was double-clicked", () => {
        mode = "desktop";
        const onMoveToSideboard = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMoveToSideboard },
        });
        doubleClickLikeABrowser(screen.getByTitle(/Remove Lightning Bolt/));
        const overlay = document.querySelector("[data-inspect-overlay]")!;
        fireEvent.click(
            [...overlay.querySelectorAll("button")].find(
                (el) => el.textContent === "→ Side"
            )!
        );
        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The bottom bar and the basics sheet.
// ────────────────────────────────────────────────────────────────────────────
describe("DeckBuilderShell — the phone bottom bar (issue #2584)", () => {
    it("replaces SaveDeckBar in portrait, carrying its name, its Delete and its Done", () => {
        const onChangeName = vi.fn();
        const onDelete = vi.fn();
        const onDone = vi.fn();
        const { container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            sideCards: [card(PLAINS_ID, "Plains")],
            onDone,
            saveBar: {
                name: "Burn",
                cardCount: 1,
                onChangeName,
                onDelete,
            },
        });

        const bar = container.querySelector("[data-deck-bottom-bar]")!;
        expect(bar.textContent).toContain("Main 1");
        expect(bar.textContent).toContain("Side 1");
        expect(container.querySelectorAll("form")).toHaveLength(1);
        expect(
            (screen.getByLabelText("Deck name") as HTMLInputElement).value
        ).toBe("Burn");

        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        expect(onDelete).toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(onDone).toHaveBeenCalled();
    });

    it("moves the basics bar into a sheet behind `Lands`, and renders no inline basics band", () => {
        const { container } = renderShell({
            basicsBar: <div data-testid="basics">basics</div>,
        });
        expect(screen.queryByTestId("basics")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Lands" }));
        expect(screen.getByTestId("basics")).toBeTruthy();
        expect(container.querySelector("[data-basics-sheet]")).toBeNull();
        expect(document.querySelector("[data-basics-sheet]")).toBeTruthy();
    });

    it("offers no `Lands` button for a variant that declares no basics bar", () => {
        renderShell({});
        expect(screen.queryByRole("button", { name: "Lands" })).toBeNull();
    });

    it("carries DECK LEGALITY — an illegal deck says so, in the bar, at 390x844", () => {
        // PR #2641 review, blocker 3: `DeckLegalityPanel` is dropped in
        // portrait and `SaveDeckBar` (whose `short-viewport:` row holds the
        // chip) is REPLACED by this bar, and that row only matches
        // `(max-height: 500px)` — never a 390x844 phone. Legality had no home
        // on the one viewport this slice is about.
        const { container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            legality: {
                formatLabel: "Premodern",
                isLegal: false,
                reasons: [
                    { code: "deck-size", message: "Deck has 1 card (min 60)" },
                ],
            },
        });
        const bar = container.querySelector("[data-deck-bottom-bar]")!;
        expect(bar.textContent).toContain("Illegal (1)");
        expect(bar.querySelector('[title*="Premodern illegal"]')).toBeTruthy();
    });

    it("says so when the deck IS legal, rather than falling silent", () => {
        const { container } = renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            legality: {
                formatLabel: "Premodern",
                isLegal: true,
                reasons: [],
            },
        });
        const bar = container.querySelector("[data-deck-bottom-bar]")!;
        expect(bar.textContent).toContain("Legal");
    });
});
