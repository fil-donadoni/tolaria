// Issue #2665 — the LANDSCAPE-PHONE rung of the shared deck-zone surface.
//
// The bug this file guards is a classification failure, not a styling one. The
// Column strip's density came from `md:gap-6 md:p-4`, and Tailwind's `md` is a
// 768px WIDTH breakpoint: a sideways phone is 844px WIDE, so it cleared `md:`
// and was handed the desktop gutter on a viewport with 390px of height. Nothing
// those classes can see tells the two shapes apart — only the HEIGHT does, and
// that is exactly what `useViewportMode()` (and its CSS twin `compact-chrome:`)
// discriminate on. So every assertion here is keyed on the viewport MODE, and
// each one is paired with the desktop control it must not disturb.
//
// happy-dom has no layout engine and evaluates no media query, so the PIXEL
// proof is the browser receipt in the PR (`bun run check:ui`, five viewports,
// `.claude/rules/chrome-debug.md`). What is observable here is the branch: which
// rung the component emits for a given mode, that the tile floor is a `max()`
// over the inherited width rather than a replacement, and — the one that has
// nothing to do with CSS — that a headerless Column is still the same
// registered drop target.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { createColumnLayout } from "@convex/deckLayout";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { CARD_LANDSCAPE_COMPACT_W } from "~/lib/cardSizing";
import DeckZoneSurface, {
    type DeckZoneSurfaceProps,
} from "../deck-zone-surface";

// The single seam under test, driven explicitly so happy-dom's media-query
// support never decides the branch — the same pattern `compact-chrome.test.tsx`
// and `board/__tests__/controller-landscape.test.tsx` already use.
let mode: ViewportMode = "desktop";
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => mode,
}));

// Records every droppable this render REGISTERS, then delegates to the real
// hook — the assertion "the Column is still a drop target" has to be about
// registration, not about a `data-column` attribute that would survive the
// droppable being torn out from under it.
const registered: { id: string; disabled: boolean }[] = [];
vi.mock("@dnd-kit/react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@dnd-kit/react")>();
    return {
        ...actual,
        useDroppable: (input: Parameters<typeof actual.useDroppable>[0]) => {
            registered.push({
                id: String(input.id),
                disabled: input.disabled === true,
            });
            return actual.useDroppable(input);
        },
    };
});

afterEach(() => {
    cleanup();
    mode = "desktop";
    registered.length = 0;
});

const BOLT = {
    cardId: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    cardName: "Lightning Bolt",
}; // MV 1
const PLAINS = {
    cardId: "b1623d57-4729-4796-b3f7-f1837a05c6ed",
    cardName: "Plains",
}; // land

function renderZone(props: Partial<DeckZoneSurfaceProps> = {}) {
    const base: DeckZoneSurfaceProps = {
        zone: "maindeck",
        title: "Maindeck",
        cards: [BOLT, PLAINS],
        layout: createColumnLayout(),
        onGroupingChange: () => {},
        onOrderingChange: () => {},
        dropModel: "columns",
        onCardClick: () => {},
        cardTitle: (card) => `Remove ${card.cardName}`,
        emptyMessage: "empty",
        // Column management is offered, so the header's `actions` slot is
        // populated wherever a header exists at all.
        onRenameColumn: () => {},
        onDeleteColumn: () => {},
        onPin: () => {},
    };
    return render(
        <DragDropProvider>
            <DeckZoneSurface {...base} {...props} />
        </DragDropProvider>
    );
}

/** Every mounted Column, in render order. */
function columns(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>("[data-column]")];
}

/** The Column strip — the flex scroller the Columns are children of. */
function strip(container: HTMLElement): HTMLElement {
    return columns(container)[0].parentElement as HTMLElement;
}

describe("DeckZoneSurface — landscape-phone Column density (issue #2665)", () => {
    it("drops the per-Column header on landscape-compact, and keeps it on desktop", () => {
        const desktop = renderZone().container;
        const desktopColumns = columns(desktop).length;
        expect(desktopColumns).toBeGreaterThan(0);
        expect(columns(desktop)[0].querySelector("span")?.textContent).toBe(
            "Lands"
        );

        cleanup();
        mode = "landscape-compact";
        const phone = renderZone().container;
        // "No header" must not be satisfied by "no Columns" — the next test
        // owns that distinction, but state the floor here too.
        expect(columns(phone).length).toBe(desktopColumns);
        for (const column of columns(phone)) {
            // The header row is the Column's own first child when it exists.
            // Its absence is what frees the vertical band; a Column with one
            // child is a bare pile of tiles.
            expect(column.children.length).toBe(1);
        }
        // …and no Column label survives anywhere in the strip.
        expect(phone.textContent).not.toContain("Lands");
    });

    it("keeps every Column a registered drop target with the header gone — same ids, same enabled flags as desktop", () => {
        renderZone();
        const desktopIds = columns(document.body).map(
            (el) => el.dataset.column
        );
        const desktopDroppables = [...registered].sort((a, b) =>
            a.id.localeCompare(b.id)
        );
        expect(desktopIds.length).toBeGreaterThan(1);

        cleanup();
        registered.length = 0;
        mode = "landscape-compact";
        const phone = renderZone().container;

        // Suppressing the header must not unmount, unregister or disable the
        // Column: `useDroppable`'s ref and `data-column` both live on the outer
        // element, which renders unconditionally.
        expect(columns(phone).map((el) => el.dataset.column)).toEqual(
            desktopIds
        );
        expect(
            [...registered].sort((a, b) => a.id.localeCompare(b.id))
        ).toEqual(desktopDroppables);
    });

    it("renders no Column-management controls where there is no header to hold them", () => {
        const desktop = renderZone().container;
        expect(
            desktop.querySelectorAll("[data-column] button").length
        ).toBeGreaterThan(0);

        cleanup();
        mode = "landscape-compact";
        const phone = renderZone().container;
        // Not merely hidden — a CSS-hidden control is a zero-size dead tab stop
        // the browser probe counts (issue #2511). The Column's own subtree
        // holds no `<button>` at all on this rung.
        expect(phone.querySelectorAll("[data-column] button")).toHaveLength(0);
    });

    it("emits the TIGHT gap/padding rung on landscape-compact and the width ladder everywhere else", () => {
        const desktop = strip(renderZone().container).className.split(/\s+/);
        expect(desktop).toContain("p-3");
        expect(desktop).toContain("md:p-4");
        expect(desktop).toContain("gap-3");
        expect(desktop).toContain("md:gap-6");

        cleanup();
        mode = "landscape-compact";
        const phone = strip(renderZone().container).className.split(/\s+/);
        expect(phone).toContain("p-2");
        expect(phone).toContain("gap-2");
        // The `md:` rung must not merely be OUT-ORDERED — a landscape phone is
        // 844px wide, so `md:` matches, and two variants of equal specificity
        // are resolved by whichever order Tailwind happens to emit. The tight
        // rung is only reliable if the wide one is not in the class list.
        expect(phone).not.toContain("md:p-4");
        expect(phone).not.toContain("md:gap-6");
    });

    it("floors the tile width on landscape-compact over the INHERITED width, so the zoom slider still scales up and no other viewport moves", () => {
        const desktopStrip = strip(renderZone().container);
        expect(desktopStrip.style.getPropertyValue("--card-w")).toBe("");

        cleanup();
        mode = "landscape-compact";
        const container = renderZone().container;
        const pane = container.firstElementChild as HTMLElement;
        // Two elements, on purpose: a custom property whose value reads itself
        // is a cycle and computes to nothing, so the pane captures the
        // inherited width and the strip floors that capture.
        expect(pane.style.getPropertyValue("--card-w-inherited")).toBe(
            "var(--card-w)"
        );
        const floored = strip(container).style.getPropertyValue("--card-w");
        expect(floored).toBe(
            `max(${CARD_LANDSCAPE_COMPACT_W}, var(--card-w-inherited))`
        );
        // `max()`, never a bare replacement: a replacement would pin the tile
        // to the rung and silently kill the per-zone zoom slider on this rung.
        expect(floored.startsWith("max(")).toBe(true);
        expect(strip(container).style.getPropertyValue("--card-h")).toBe(
            `calc(max(${CARD_LANDSCAPE_COMPACT_W}, var(--card-w-inherited)) * 7 / 5)`
        );
    });

    // The issue's acceptance bar is a MEASURED one ("at least 20% larger than
    // on `main`"), and the two baselines it is measured against were taken at
    // 844x390x3 on 2026-08-22: the deckbuilder Maindeck at 90.0px (the wider of
    // the two) and the Draft Room Pool at 37.0px. happy-dom cannot re-measure
    // that, but it can hold the constant to the arithmetic, so a later tune
    // that quietly drops below the bar goes red here instead of in a browser
    // nobody re-runs.
    it("the rung constant clears 1.2x the widest measured 844x390 baseline", () => {
        const WIDEST_BASELINE_PX = 90;
        expect(CARD_LANDSCAPE_COMPACT_W.endsWith("rem")).toBe(true);
        const px = parseFloat(CARD_LANDSCAPE_COMPACT_W) * 16;
        expect(px).toBeGreaterThanOrEqual(WIDEST_BASELINE_PX * 1.2);
    });
});
