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
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
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
import { DECK_SOURCE_DOCK_QUERY } from "~/hooks/useDeckSourceDock";
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
            sourcePanel: {
                label: "Search",
                count: 1,
                content: <div data-testid="source">results</div>,
            },
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

    it("a foldable action alone does NOT flip carriesControls — it renders but the band still hides (issue #1631 fixup F1)", () => {
        // `headerFoldableActions` exists precisely for a control that is
        // nice-to-have in the header but not worth keeping the band on
        // screen for (the Limited pool builder's Stats button, whose header
        // otherwise carries only Back + title and must keep hiding under
        // short-viewport per issue #2056). Real `headerActions` still wins
        // when both are present, since the band then genuinely carries a
        // control it cannot afford to hide.
        const { container, getByText } = renderShell({
            headerFoldableActions: <button type="button">Stats</button>,
        });
        expect(getByText("Stats")).toBeTruthy();
        const header = container.querySelector("[data-deckbuilder-header]")!;
        expect(header.className.split(/\s+/)).toContain(
            "short-viewport:hidden"
        );

        const withBoth = renderShell({
            headerActions: <button type="button">Import</button>,
            headerFoldableActions: <button type="button">Stats</button>,
        }).container.querySelector("[data-deckbuilder-header]")!;
        const classes = withBoth.className.split(/\s+/);
        expect(classes).not.toContain("short-viewport:hidden");
        expect(classes).toContain("short-viewport:py-1");
    });

    it("defaults SaveDeckBar's folded twin to headerFoldableActions when the caller omits saveBar.foldableActions (issue #1631 fixup R-F7)", () => {
        // The pairing used to be enforced by prose only ("a caller supplying
        // headerFoldableActions MUST also supply saveBar.foldableActions or
        // the control is lost"). This proves the structural fallback: a
        // caller that sets ONLY `headerFoldableActions` still gets the
        // control folded into `SaveDeckBar`'s short-viewport row, with no
        // separate `saveBar.foldableActions` at all.
        const { container } = renderShell({
            headerFoldableActions: <button type="button">Stats</button>,
            saveBar: { name: "Deck", cardCount: 0, onChangeName: () => {} },
        });
        const form = container.querySelector("form")!;
        // Adapted for happy-dom (issue #2435): `getAllByText("Stats").find(el
        // => form.contains(el))` — an UPWARD walk from the found node — no
        // longer distinguishes the two "Stats" buttons under happy-dom.
        // Root-caused with a standalone debug run (not a CSSOM string quirk):
        // for this component's `<form>`, `realSpan.parentElement !== form`
        // even though `realSpan` was itself obtained via `form.
        // querySelectorAll("span")` — happy-dom's own downward query and its
        // `.parentElement` back-pointer disagree about this element's parent.
        // `form.contains(el)` (jsdom, and the DOM spec) is defined as exactly
        // that upward walk, so it inherits the same divergence.
        // A DOWNWARD query rooted at `form` sidesteps the broken back-pointer
        // entirely and asserts the identical fact — "the folded Stats control
        // is a descendant of the save-bar form" — the same coverage as
        // before, reached without the affected primitive.
        const foldedStats = Array.from(form.querySelectorAll("button")).find(
            (el) => el.textContent === "Stats"
        );
        expect(foldedStats).toBeTruthy();
        const wrapper = foldedStats!.closest("span")!;
        expect(wrapper.className.split(/\s+/)).toEqual(
            expect.arrayContaining(["hidden", "short-viewport:inline-flex"])
        );
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

        // The third argument is the dragged COPY's pin key (issue #1626);
        // entries carrying no `pinKey` fall back to the card id — the
        // Constructed rule.
        expect(onPin).toHaveBeenCalledWith(BOLT_ID, "mv:6", BOLT_ID);
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

        // The dragged COPY travels with the move (issue #1626); with no
        // per-copy key on the entry it is the card id.
        expect(onMoveToMaindeck).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
        expect(onPin).toHaveBeenCalledWith(BOLT_ID, "mv:lands", BOLT_ID);
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

        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID, BOLT_ID);
        expect(onPin).not.toHaveBeenCalled();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The source-DOCK basics-bar fold (issue #2585 review finding #3, PR #2653
// round-3 review finding #2). `isSourceDock` (`deck-builder-shell.tsx`) has
// two independent inputs — `Boolean(sourcePanel)` (review finding #5's own
// gate) AND `useDeckSourceDock()`'s viewport predicate — ANDed together, and
// neither half had a test before this block: round-3 review killed the whole
// gate two different ways (`isSourceDock = ... && false`, which silently
// un-folds the bar everywhere, and `isSourceDock = dockActive`, which drops
// the `sourcePanel` gate and folds Limited's bar too) with all 535 existing
// tests staying green.
//
// happy-dom DOES evaluate `DECK_SOURCE_DOCK_QUERY` (proved by
// `basic-land-art-picker.test.tsx`'s own `matchMedia` stub, whose ABSENCE
// reds all 9 of that file's tests), so the predicate is testable at this
// layer: stub `matchMedia` to match ONLY `DECK_SOURCE_DOCK_QUERY` — every
// other query (`useViewportMode`'s `PORTRAIT_QUERY` /
// `LANDSCAPE_COMPACT_QUERY` included) reports no match, which also pins
// `viewportMode` to `"desktop"` for free, so nothing here depends on
// happy-dom's own default window size.
// ────────────────────────────────────────────────────────────────────────────
describe("DeckBuilderShell — source-dock basics-bar fold (issue #2585 review finding #3)", () => {
    const realMatchMedia = window.matchMedia;

    function stubDockViewport() {
        (
            window as unknown as { matchMedia: (q: string) => unknown }
        ).matchMedia = (query: string) => ({
            matches: query === DECK_SOURCE_DOCK_QUERY,
            media: query,
            addEventListener() {},
            removeEventListener() {},
        });
    }

    afterEach(() => {
        window.matchMedia = realMatchMedia;
    });

    it("folds the Add Basic bar behind a trigger when a source panel is present at a dock-shaped viewport, and the trigger opens the Basics sheet", () => {
        stubDockViewport();
        const { queryByTestId, getByRole, getAllByTestId } = renderShell({
            sourcePanel: {
                label: "Search",
                count: 1,
                content: <div data-testid="source">results</div>,
            },
            basicsBar: <div data-testid="basics">Add Basic content</div>,
        });

        // The inline band is ABSENT — folded, not just visually collapsed
        // (`DeckBasicsSheet` unmounts its children while closed).
        expect(queryByTestId("basics")).toBeNull();
        expect(document.querySelector("[data-basics-sheet]")).toBeNull();

        const trigger = getByRole("button", { name: "Add Basic" });
        fireEvent.click(trigger);

        // The sheet opens with the bar's content, and it is the ONLY copy —
        // the inline band (folded above) never joins it once the sheet mounts.
        expect(document.querySelector("[data-basics-sheet]")).toBeTruthy();
        expect(getAllByTestId("basics")).toHaveLength(1);
    });

    it("does NOT fold the Add Basic bar at a dock-shaped viewport when no source panel is supplied (round-1 finding #5's own gate) — the bar stays inline, as Limited's does", () => {
        stubDockViewport();
        const { getByTestId, queryByRole } = renderShell({
            basicsBar: <div data-testid="basics">Add Basic content</div>,
        });

        // No source panel at all — the trigger this predicate would otherwise
        // create never appears, and the band renders inline, unfolded.
        expect(getByTestId("basics")).toBeTruthy();
        expect(queryByRole("button", { name: "Add Basic" })).toBeNull();
        expect(document.querySelector("[data-basics-sheet]")).toBeNull();
    });
});
