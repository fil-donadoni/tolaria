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
import { useState } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
    act,
    render,
    cleanup,
    fireEvent,
    screen,
} from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import { createDeckColumnLayout } from "@convex/deckLayout";
import type { DeckCard } from "~/types/game";
import { cardBase } from "~/lib/cardSizing";
import type { ViewportMode } from "~/hooks/useViewportMode";
import { resetPreviewSingleton } from "~/components/cards/card-preview-singleton";
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
    // `CardPreview`'s one-open-at-a-time singleton is module state: a pinned
    // preview left behind by one test would refuse the next one's open.
    resetPreviewSingleton();
});

/** A REAL pointer double-click. A browser delivers one as click(detail 1),
 *  click(detail 2), dblclick — `fireEvent.doubleClick` alone synthesises none
 *  of the preceding clicks, which is why the first shipped guard never saw the
 *  two removals the sequence caused (PR #2641 review, blocker 1). */
function doubleClickLikeABrowser(el: Element) {
    fireEvent.click(el, { detail: 1 });
    fireEvent.click(el, { detail: 2 });
    fireEvent.doubleClick(el, { detail: 2 });
}

/** Let `ms` of fake time pass the way a browser lets real time pass: every
 *  callback that comes due is COMMITTED before the next one is. One
 *  `advanceTimersByTime(2000)` instead runs every pending callback in a single
 *  synchronous batch with no render between them — which is precisely what
 *  hides a bug whose mechanism is one action unmounting the component that
 *  owns the next one. Stepping is the faithful reading, not the fussy one. */
function letTimePass(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 20)
        act(() => {
            vi.advanceTimersByTime(20);
        });
}

/** A right click WHERE A BROWSER ACTUALLY DELIVERS ONE: on the innermost
 *  element under the cursor — the card art `<img>` — not on the tile div that
 *  wraps it, and with the `pointerup` that `useRightPressPreview` listens for
 *  on `window`.
 *
 *  This distinction is the whole point (PR #2641 review round 3). `CardImage`
 *  mounts `CardPreview`, which binds the desktop pin gesture on a DESCENDANT
 *  of the tile, so a dispatch aimed at the tile div never runs those handlers
 *  and a guard written that way is blind to anything they do. */
function rightClickTheCardArt(tile: Element) {
    const art = tile.querySelector("img") ?? tile;
    act(() => {
        fireEvent.pointerDown(art, { pointerType: "mouse", button: 2 });
    });
    act(() => {
        fireEvent(window, new Event("pointerup"));
    });
    act(() => {
        fireEvent.contextMenu(art);
    });
}

/** The same place, pressed by a FINGER: `pointerdown` with the primary button
 *  (a touchscreen has no secondary one), held, then the `contextmenu` Android
 *  and iOS raise off a long press. */
function longPressTheCardArt(tile: Element) {
    const art = tile.querySelector("img") ?? tile;
    act(() => {
        fireEvent.pointerDown(art, { pointerType: "touch", button: 0 });
    });
    act(() => {
        fireEvent.contextMenu(art);
    });
}

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // Mountain (land)

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

/** The shell with a REAL, STATEFUL deck behind it: clicking a Maindeck tile
 *  removes that copy from the list the shell is rendering, exactly as the
 *  Constructed builder's `onMainCardClick` does. `renderShell` above is
 *  controlled — its `mainCards` never change — so it cannot see anything that
 *  depends on the tiles RE-RENDERING after a click, which is the whole
 *  mechanism behind the round-2 blocker (a removal re-indexes its Column, the
 *  neighbouring tiles' keys change, and they unmount mid-gesture).
 *
 *  Returns the removal log, in order. */
function renderStatefulShell(initial: DeckCard[]): string[] {
    const removed: string[] = [];
    function Harness() {
        const [main, setMain] = useState(initial);
        return (
            <DeckBuilderShell
                title="Edit Deck"
                onDone={() => {}}
                mainCards={main}
                sideCards={[]}
                layout={createDeckColumnLayout()}
                view={VIEW}
                zones={{
                    mainEmptyMessage: "main empty",
                    sideEmptyMessage: "side empty",
                }}
                actions={{
                    ...NO_ACTIONS,
                    onMainCardClick: (clicked) => {
                        removed.push(clicked.cardName);
                        setMain((cur) => {
                            const at = cur.findIndex(
                                (c) => c.cardId === clicked.cardId
                            );
                            return at < 0
                                ? cur
                                : [...cur.slice(0, at), ...cur.slice(at + 1)];
                        });
                    },
                }}
            />
        );
    }
    render(<Harness />);
    return removed;
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

    it("opens exactly ONE card-reading surface on a desktop right click — the tile takes no secondary-button gesture", () => {
        // PR #2641 review round 3, the blocker rounds 1-2 kept missing: the
        // secondary button on this tile is ALREADY SPOKEN FOR. `CardImage`
        // mounts `CardPreview`, whose `useRightPressPreview` pins the anchored
        // 330px preview on a quick right-click, and `holdPreview={false}`
        // suppresses only the TOUCH gesture ("Only the TOUCH gesture is
        // suppressed", card-preview.tsx). While the tile ALSO bound
        // `contextmenu` -> Inspect, a right click where a browser hit-tests
        // put BOTH portals in the document at once — both at `z-modal`, so
        // which one painted on top was decided by document order and
        // therefore by the PLATFORM (Windows/Linux raise `contextmenu` on
        // mouse-DOWN, before `pointerup`; macOS after).
        //
        // So the invariant is not "the overlay opens" — it is "one surface
        // opens", and the one that opens is the pre-existing pin.
        mode = "desktop";
        const onMainCardClick = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            actions: { onMainCardClick },
        });

        rightClickTheCardArt(screen.getByTitle(/Remove Lightning Bolt/));

        expect(
            document.querySelectorAll("[data-card-preview-anchored]")
        ).toHaveLength(1);
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
        // ...and it moves nothing, exactly as on `main`.
        expect(onMainCardClick).not.toHaveBeenCalled();
    });

    it("a TOUCH long-press on the art opens NEITHER surface — on this surface a long press is the drag", () => {
        // Android/iOS raise `contextmenu` on a long press, and gesture model A
        // (ADR 0101, 250ms) makes a long press the DRAG here, so nothing may
        // appear under the finger: not the Inspect Overlay, and not the
        // preview either (which is what `holdPreview={false}` is for, issue
        // #2583). Touch reaches a card read through its own path:
        // tap -> Peek Panel -> `Inspect`.
        mode = "desktop";
        renderShell({ mainCards: [card(BOLT_ID, "Lightning Bolt")] });

        longPressTheCardArt(screen.getByTitle(/Remove Lightning Bolt/));

        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
        expect(
            document.querySelector("[data-card-preview-anchored]")
        ).toBeNull();
    });

    it("two quick clicks on two DIFFERENT cards in one Column both land", () => {
        // PR #2641 review round 2 — the blocker the round-1 remedy introduced.
        // The deferred single click lived in a per-tile ref that
        // `useEffect(() => cancelPendingClick, [])` discarded on unmount, and
        // the tile key carried the card's INDEX in its Column. So the first
        // click's own removal re-indexed its neighbours, unmounted them, and
        // silently ate a second click made less than the double-click window
        // later — a user cutting cards at ~3/sec, with nothing on screen to
        // say a click had been dropped. Mountain and Plains are both basic
        // lands, so they share one Column, and Mountain sorts first.
        mode = "desktop";
        const removed = renderStatefulShell([
            card(MOUNTAIN_ID, "Mountain"),
            card(PLAINS_ID, "Plains"),
        ]);

        vi.useFakeTimers();
        fireEvent.click(screen.getByTitle(/Remove Mountain/), { detail: 1 });
        letTimePass(120);
        fireEvent.click(screen.getByTitle(/Remove Plains/), { detail: 1 });
        letTimePass(2000);

        expect(removed).toEqual(["Mountain", "Plains"]);
        expect(screen.queryByTitle(/Remove Mountain/)).toBeNull();
        expect(screen.queryByTitle(/Remove Plains/)).toBeNull();
    });

    it("...and so do two SLOW ones, 400ms apart", () => {
        // The far side of the window the round-1 remedy opened: this case
        // passed even while the fast one silently lost a click, so pinning
        // only the fast one would leave the pair looking arbitrary.
        mode = "desktop";
        const removed = renderStatefulShell([
            card(MOUNTAIN_ID, "Mountain"),
            card(PLAINS_ID, "Plains"),
        ]);

        vi.useFakeTimers();
        fireEvent.click(screen.getByTitle(/Remove Mountain/), { detail: 1 });
        letTimePass(400);
        fireEvent.click(screen.getByTitle(/Remove Plains/), { detail: 1 });
        letTimePass(2000);

        expect(removed).toEqual(["Mountain", "Plains"]);
    });

    it("rapid clicks on one card cut one copy each — the pre-#2584 desktop gesture, unchanged", () => {
        // `main`'s behaviour, restored: three clicks cut three copies. The
        // round-1 deferred click turned this into ZERO cuts plus an overlay,
        // because the browser's click,click,dblclick was being arbitrated;
        // with Inspect on the secondary button there is nothing to arbitrate.
        mode = "desktop";
        const removed = renderStatefulShell([
            card(BOLT_ID, "Lightning Bolt"),
            card(BOLT_ID, "Lightning Bolt"),
            card(BOLT_ID, "Lightning Bolt"),
        ]);

        doubleClickLikeABrowser(
            screen.getAllByTitle(/Remove Lightning Bolt/)[0]
        );
        fireEvent.click(screen.getAllByTitle(/Remove Lightning Bolt/)[0], {
            detail: 3,
        });

        expect(removed).toEqual([
            "Lightning Bolt",
            "Lightning Bolt",
            "Lightning Bolt",
        ]);
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
    });

    it("reaches `★ Featured` from the DECK-DETAIL row at a pointer viewport — a mouse never opens the Peek Panel", () => {
        // PR #2641 review, blockers 2 and 3. `featured-card-button.tsx` is
        // deleted (it was one of the per-card overlay buttons this issue
        // removes), and the replacement CTA lives in the Peek Panel — which
        // only a TAP ever opens. On desktop a click MOVES the card, so the
        // panel never appears and PRD #589's picker needs a home that is not a
        // card gesture at all. Issue #2584 names one: "Featured moves to the
        // Inspect Overlay / deck detail".
        mode = "desktop";
        const onSet = vi.fn();
        renderShell({
            mainCards: [
                card(BOLT_ID, "Lightning Bolt"),
                card(BOLT_ID, "Lightning Bolt"),
                card(PLAINS_ID, "Plains"),
            ],
            featured: { cardId: BOLT_ID, onSet },
            saveBar: { name: "Burn", cardCount: 3, onChangeName: () => {} },
        });

        // The touch CTA is genuinely out of reach here — the click moved on.
        fireEvent.click(screen.getAllByTitle(/Remove Lightning Bolt/)[0]);
        expect(screen.queryByRole("button", { name: "★ Featured" })).toBeNull();

        const select = screen.getByLabelText(
            "Featured card"
        ) as HTMLSelectElement;
        // One entry per DISTINCT card, in deck order, plus `Auto`.
        expect([...select.options].map((o) => o.textContent)).toEqual([
            "Featured: Auto",
            "Lightning Bolt",
            "Plains",
        ]);

        fireEvent.change(select, { target: { value: PLAINS_ID } });
        expect(onSet).toHaveBeenCalledWith(PLAINS_ID);
    });

    it("offers `Auto` as a real choice — the only way back off an explicit pick", () => {
        // `toggleFeatured` clears the override by re-picking the featured card,
        // which a `<select>` cannot do: choosing the value it already shows
        // fires no `change`. So `Auto` sends `null` and the builder's handler
        // treats that as the clear (issue #2584).
        mode = "desktop";
        const onSet = vi.fn();
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            featured: { cardId: BOLT_ID, explicitCardId: BOLT_ID, onSet },
            saveBar: { name: "Burn", cardCount: 1, onChangeName: () => {} },
        });

        const select = screen.getByLabelText(
            "Featured card"
        ) as HTMLSelectElement;
        expect(select.value).toBe(BOLT_ID);
        fireEvent.change(select, { target: { value: "" } });
        expect(onSet).toHaveBeenCalledWith(null);
    });

    it("renders no picker while the Maindeck is empty — nothing to feature yet", () => {
        // Every new Constructed deck starts here, and an empty `<select>` in
        // the deck-detail row would be a control that cannot do anything.
        mode = "desktop";
        renderShell({
            mainCards: [],
            featured: { cardId: null, onSet: () => {} },
            saveBar: { name: "New", cardCount: 0, onChangeName: () => {} },
        });
        expect(screen.queryByLabelText("Featured card")).toBeNull();
    });

    it("renders no picker for a variant that declares no Featured affordance", () => {
        // The Limited builders pass no `featured` spec — the Featured Card is
        // a Constructed concept, and the deck-detail row must not sprout a
        // control for it there.
        mode = "desktop";
        renderShell({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            saveBar: { name: "Pool", cardCount: 1, onChangeName: () => {} },
        });
        expect(screen.queryByLabelText("Featured card")).toBeNull();
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
