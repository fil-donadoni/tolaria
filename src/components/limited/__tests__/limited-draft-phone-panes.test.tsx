// The Draft Room's two PHONE arrangements (issue #2588, PRD #2405 slice 9,
// ADR 0101 §6) — driven through the REAL projection, like every other test on
// this surface, because what the panes read (`currentPack`, `pool`,
// `poolArrangement`, `pickDeadline`) is per-seat stripped on the way out
// (`convex/limited/eventProjection.ts`).
//
// happy-dom has no layout engine, so nothing here asserts a MEASURED pane:
// the geometry is asserted on the pure module (`draftSnapStops.test.ts`) and
// in the browser (the five-viewport probe in the PR). What these prove is the
// WIRING — that each arrangement mounts its own bands, that the strip's drop
// targets exist, that the single-mount primitives stay single, and that the
// arrival/recall/density rules fire.
import {
    describe,
    it,
    expect,
    vi,
    beforeAll,
    beforeEach,
    afterEach,
} from "vitest";
import {
    render,
    fireEvent,
    waitFor,
    cleanup,
    act,
} from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import { DragDropManager } from "@dnd-kit/dom";
import { installDndJsdomShims } from "~/components/deckbuilder/__tests__/dragHarness";
import { draftStripDropId } from "../limitedDraftDrag";
import { zonePaneDropId } from "~/components/deckbuilder/deckZoneDrag";
import LimitedDraftTable from "../limited-draft-table";

const reduceMotionMock = vi.fn(() => false);
vi.mock("motion/react", () => ({
    useReducedMotion: () => reduceMotionMock(),
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

const submitPickMock = vi.fn().mockResolvedValue(null);
const setPoolArrangementEntryMock = vi.fn().mockResolvedValue(null);
const selectDraftPickMock = vi.fn().mockResolvedValue(null);
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        limitedEvents: {
            submitPick: "submitPick",
            setPoolArrangementEntry: "setPoolArrangementEntry",
            selectDraftPick: "selectDraftPick",
        },
    },
}));

beforeEach(() => {
    vi.clearAllMocks();
    reduceMotionMock.mockReturnValue(false);
    submitPickMock.mockResolvedValue(null);
    setPoolArrangementEntryMock.mockResolvedValue(null);
    selectDraftPickMock.mockResolvedValue(null);
    useMutationMock.mockImplementation((ref: string) => {
        switch (ref) {
            case "submitPick":
                return submitPickMock;
            case "setPoolArrangementEntry":
                return setPoolArrangementEntryMock;
            case "selectDraftPick":
                return selectDraftPickMock;
            default:
                return vi.fn().mockResolvedValue(null);
        }
    });
});

beforeAll(() => installDndJsdomShims());

afterEach(() => cleanup());

type Layout = "phone-portrait" | "phone-landscape" | "split" | "stacked";

type Options = {
    selectedPickId?: string;
    poolLength?: number;
    packSize?: number;
    packOffset?: number;
    pickDeadline?: number;
    sideboardIndexes?: number[];
};

function eventRow(options: Options): LimitedEventRow {
    const poolLength = options.poolLength ?? 0;
    const packSize = options.packSize ?? 2;
    const offset = options.packOffset ?? 0;
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: Array.from({ length: poolLength }, (_, i) => ({
                    scryfallId: `s-existing-${i}`,
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                })),
                poolArrangement: (options.sideboardIndexes ?? []).map(
                    (poolIndex) => ({ poolIndex, sideboard: true })
                ),
                currentPack: Array.from({ length: packSize }, (_, i) => ({
                    scryfallId: `s${i + offset}`,
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                    pickId: `r0-p0-c${i + offset}`,
                })),
                selectedPickId: options.selectedPickId,
                pickDeadline: options.pickDeadline,
            },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function renderTable(
    layout: Layout,
    options: Options = {},
    /** dnd-kit manager to inject. Passing one is how a test can tell whether
     *  the surface's droppables landed in THE provider or in a second one an
     *  arm minted for itself — see the single-mount guard below. */
    manager?: DragDropManager
) {
    const view = projectLimitedEvent(eventRow(options), "user1");
    const seat = view.seats.find((s) => s.seatIndex === 0)!;
    const props = {
        eventId: "event-1" as never,
        seat: { ...seat, autoBuiltDeck: null },
        round: 0,
        layout,
        manager,
    };
    const utils = render(<LimitedDraftTable {...props} />);
    return {
        ...utils,
        /** Re-render with a NEW projection — the wire changing under the
         *  surface, which is how a pack actually arrives. */
        push(next: Options) {
            const nextView = projectLimitedEvent(eventRow(next), "user1");
            const nextSeat = nextView.seats.find((s) => s.seatIndex === 0)!;
            utils.rerender(
                <LimitedDraftTable
                    {...props}
                    seat={{ ...nextSeat, autoBuiltDeck: null }}
                />
            );
        },
    };
}

const scroller = () =>
    document.querySelector("[data-slot=draft-snap-scroller]") as HTMLElement;
const panes = () => [...document.querySelectorAll("[data-slot=draft-pane]")];
const dropZones = () =>
    [
        ...document.querySelectorAll("[data-slot=draft-strip-drop]"),
    ] as HTMLElement[];
const actionEls = () =>
    [...document.querySelectorAll("[data-editing-action]")] as HTMLElement[];

describe("phone portrait — two snap stops, Pack 85 / Pool 15 (issue #2588 AC 1)", () => {
    it("mounts ONE snap scroller holding exactly the two panes, each 85% of it", () => {
        renderTable("phone-portrait");
        expect(
            document.querySelectorAll("[data-slot=draft-snap-scroller]").length
        ).toBe(1);
        expect(scroller().dataset.orientation).toBe("portrait");
        expect(scroller().className).toContain("snap-mandatory");
        expect(panes().map((p) => (p as HTMLElement).dataset.pane)).toEqual([
            "pack",
            "pool",
        ]);
        for (const pane of panes()) {
            expect((pane as HTMLElement).style.height).toBe("85%");
        }
    });

    it("splits the pool strip into a Pool half and a Sideboard half, each a drop target", () => {
        renderTable("phone-portrait", { poolLength: 3, sideboardIndexes: [2] });
        expect(dropZones().map((el) => el.dataset.zone)).toEqual([
            "maindeck",
            "sideboard",
        ]);
        // The counts come from the SAME split the Pool pane renders from.
        expect(
            document.querySelector("[data-slot=draft-pool-count]")!.textContent
        ).toBe("Pool · 2");
        expect(
            document.querySelector("[data-slot=draft-sideboard-count]")!
                .textContent
        ).toBe("SB · 1");
    });

    it("the strip's ids are the strip's own, never the Pool pane's — both are mounted at once", () => {
        // A shared id would collide in dnd-kit's droppable registry; this is
        // the assertion that keeps `draft-strip:` a separate vocabulary.
        expect(draftStripDropId("maindeck")).not.toBe(
            zonePaneDropId("maindeck")
        );
        expect(draftStripDropId("sideboard")).not.toBe(
            zonePaneDropId("sideboard")
        );
    });

    it("tapping the strip moves the stop, and the pack bar offers the way back", () => {
        renderTable("phone-portrait", { poolLength: 1 });
        expect(scroller().dataset.stop).toBe("pack");
        expect(
            document.querySelector("[data-slot=draft-back-to-pack]")
        ).toBeNull();

        fireEvent.click(dropZones()[0]!);
        expect(scroller().dataset.stop).toBe("pool");

        const back = document.querySelector(
            "[data-slot=draft-back-to-pack]"
        ) as HTMLElement;
        fireEvent.click(back);
        expect(scroller().dataset.stop).toBe("pack");
    });

    it("puts the CTA row in the strip and mounts NO Peek Panel", () => {
        renderTable("phone-portrait", { selectedPickId: "r0-p0-c1" });
        expect(document.querySelector("[data-peek-panel]")).toBeNull();
        const bar = document.querySelector("[data-slot=draft-pack-status]")!;
        expect(
            [...bar.querySelectorAll("[data-editing-action]")].map(
                (el) => (el as HTMLElement).dataset.editingAction
            )
        ).toEqual(["Pick", "→ Side", "Inspect"]);
    });

    it("the strip's Pick commits the SELECTED pick — the same mutation the panel's does", async () => {
        renderTable("phone-portrait", { selectedPickId: "r0-p0-c1" });
        fireEvent.click(actionEls()[0]!);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c1",
            })
        );
    });

    it("reserves nothing for a Peek Panel it does not mount", () => {
        const { container } = renderTable("phone-portrait", {
            selectedPickId: "r0-p0-c1",
        });
        const surface = container.querySelector(
            "[data-slot=draft-surface]"
        ) as HTMLElement;
        expect(surface.style.paddingRight).toBe("");
        expect(surface.style.paddingBottom).toBe("");
    });
});

describe("phone landscape — pack 80 | sneak-peek column 20 (issue #2588 AC 2)", () => {
    it("shows the sneak-peek column with the pile, the SB count and the actions bar", () => {
        renderTable("phone-landscape", {
            selectedPickId: "r0-p0-c0",
            poolLength: 4,
            sideboardIndexes: [3],
        });
        expect(scroller().dataset.orientation).toBe("landscape");
        const column = document.querySelector("[data-slot=draft-sneak-peek]")!;
        expect(
            column
                .querySelector("[data-slot=draft-card-pile]")!
                .getAttribute("data-count")
        ).toBe("4");
        expect(
            column.querySelector("[data-slot=draft-sideboard-count]")!
                .textContent
        ).toBe("SB · 1");
        expect(
            [...column.querySelectorAll("[data-editing-action]")].map(
                (el) => (el as HTMLElement).dataset.editingAction
            )
        ).toEqual(["Pick", "→ Side", "Inspect"]);
    });

    it("a swipe to the pool collapses the pack to a pile and gives the pool the width", () => {
        renderTable("phone-landscape", { poolLength: 2 });
        expect(
            document.querySelector("[data-slot=draft-collapsed-pack]")
        ).toBeNull();

        fireEvent.click(dropZones()[0]!);

        expect(scroller().dataset.stop).toBe("pool");
        expect(
            document.querySelector("[data-slot=draft-sneak-peek]")
        ).toBeNull();
        const collapsed = document.querySelector(
            "[data-slot=draft-collapsed-pack]"
        )!;
        expect(
            collapsed
                .querySelector("[data-slot=draft-card-pile]")!
                .getAttribute("data-count")
        ).toBe("2");
        // The Pool pane keeps its Sideboard BESIDE it here (ADR 0101 §6:
        // "MV columns + a Sideboard column"), unlike portrait's stack.
        expect(
            document
                .querySelector("[data-slot=draft-pool]")!
                .getAttribute("data-arrange")
        ).toBe("row");
    });

    it("keeps ONE Pick Timer across the swipe — never one per band", () => {
        renderTable("phone-landscape", { pickDeadline: Date.now() + 30_000 });
        expect(document.querySelectorAll("[data-slot=pick-timer]").length).toBe(
            1
        );
        fireEvent.click(dropZones()[0]!);
        expect(document.querySelectorAll("[data-slot=pick-timer]").length).toBe(
            1
        );
    });
});

describe("the single-mount primitives survive the layout fork (issue #2588)", () => {
    // The failure mode the fork invites: a pane branch that mounts its OWN
    // `DragDropProvider` / `DragOverlay` / context menu. Both copies render,
    // both work in isolation, and every unit test passes.
    //
    // Counting `[data-slot=draft-surface]` does NOT catch it — measured in
    // review round 1 of PR #2652: a second `DragDropProvider` + `DragOverlay`
    // wrapping the whole return of `draft-portrait-panes.tsx` left the entire
    // limited suite green. What catches it is the manager SEAM the surface
    // already exposes: `DragDropProvider` mints a private `DragDropManager`
    // when it is not handed one, so every droppable under a NESTED provider
    // registers there and vanishes from the one we injected. Asserting each
    // arm's own drop ids in the INJECTED registry is therefore a direct
    // "exactly one provider" assertion, not a proxy for it.

    /** The drop ids each arm is required to publish into the one manager.
     *  Portrait mounts both panes at once (the Pool is merely scrolled off),
     *  so it registers the strip's ids AND the Pool pane's; landscape parks
     *  the Pool behind the sneak-peek column, so only the strip's; the two
     *  non-phone arms have no strip at all. */
    const REGISTERED: Record<Layout, string[]> = {
        "phone-portrait": [
            draftStripDropId("maindeck"),
            draftStripDropId("sideboard"),
            zonePaneDropId("maindeck"),
            zonePaneDropId("sideboard"),
        ],
        "phone-landscape": [
            draftStripDropId("maindeck"),
            draftStripDropId("sideboard"),
        ],
        split: [zonePaneDropId("maindeck"), zonePaneDropId("sideboard")],
        stacked: [zonePaneDropId("maindeck"), zonePaneDropId("sideboard")],
    };

    const registeredIds = (manager: DragDropManager) =>
        [...manager.registry.droppables].map((d) => String(d.id));

    it.each(Object.keys(REGISTERED) as Layout[])(
        "%s registers its drop targets in the ONE injected manager",
        (layout) => {
            const manager = new DragDropManager();
            renderTable(
                layout,
                { poolLength: 3, sideboardIndexes: [2] },
                manager
            );

            const ids = registeredIds(manager);
            for (const id of REGISTERED[layout]) expect(ids).toContain(id);

            // …and by ELEMENT, not just by id: every strip half rendered in
            // the DOM must be the element the injected manager holds for that
            // id. A nested provider leaves the button on screen and the
            // registration somewhere else.
            for (const el of dropZones()) {
                const entry = [...manager.registry.droppables].find(
                    (d) => d.element === el
                );
                expect(
                    entry,
                    `strip half ${el.dataset.zone} is not registered in the injected manager`
                ).toBeTruthy();
            }
        }
    );

    it.each(Object.keys(REGISTERED) as Layout[])(
        "%s mounts exactly one surface, one DragOverlay and one Inspect Overlay",
        (layout) => {
            const manager = new DragDropManager();
            renderTable(layout, { selectedPickId: "r0-p0-c1" }, manager);
            expect(
                document.querySelectorAll("[data-slot=draft-surface]").length
            ).toBe(1);

            // The overlay only exists while a drag is live, so drive one —
            // through the injected manager, so a SECOND `DragOverlay` under
            // the same provider renders a second card and goes red here.
            const booster = [...manager.registry.draggables].find((d) =>
                String(d.id).startsWith("booster-")
            );
            expect(
                booster,
                "no Booster draggable registered in the injected manager"
            ).toBeTruthy();
            act(() => {
                void manager.actions.start({
                    source: booster!.id,
                    coordinates: { x: 0, y: 0 },
                });
            });
            expect(document.querySelectorAll("[data-dnd-overlay]").length).toBe(
                1
            );
            act(() => {
                void manager.actions.stop();
            });

            const inspect = actionEls().find(
                (el) => el.dataset.editingAction === "Inspect"
            )!;
            fireEvent.click(inspect);
            expect(
                document.querySelectorAll("[data-inspect-overlay]").length
            ).toBe(1);
        }
    );

    it.each(Object.keys(REGISTERED) as Layout[])(
        "%s mounts exactly one pick context menu on the menu path",
        (layout) => {
            renderTable(layout, { selectedPickId: "r0-p0-c1" });
            fireEvent.contextMenu(
                document.querySelector('[aria-label^="Draft pick:"]')!
            );
            expect(
                document.querySelectorAll(
                    '[role=menu][aria-label="Draft pick actions"]'
                ).length
            ).toBe(1);
        }
    );

    it("the landscape POOL arm registers its pane drops in the same injected manager", () => {
        // The other half of the landscape fork: after the swipe the pack
        // collapses and `LimitedDraftPool` mounts. A provider nested around
        // THAT branch would never show up in the pack-stop assertion above.
        const manager = new DragDropManager();
        renderTable(
            "phone-landscape",
            { poolLength: 3, sideboardIndexes: [2] },
            manager
        );
        expect(registeredIds(manager)).not.toContain(
            zonePaneDropId("maindeck")
        );

        fireEvent.click(dropZones()[0]!);

        const ids = registeredIds(manager);
        expect(ids).toContain(zonePaneDropId("maindeck"));
        expect(ids).toContain(zonePaneDropId("sideboard"));
        // …and whatever strip halves the collapsed arm still renders are
        // registered HERE too, by element.
        for (const el of dropZones()) {
            expect(
                [...manager.registry.droppables].find((d) => d.element === el),
                `strip half ${el.dataset.zone} is not registered in the injected manager`
            ).toBeTruthy();
        }
    });

    it("mounts the Peek Panel OFF the phone regimes only", () => {
        renderTable("split", { selectedPickId: "r0-p0-c1" });
        expect(document.querySelectorAll("[data-peek-panel]").length).toBe(1);
        cleanup();
        renderTable("phone-landscape", { selectedPickId: "r0-p0-c1" });
        expect(document.querySelectorAll("[data-peek-panel]").length).toBe(0);
    });
});

describe("pack arrival while parked on the pool (issue #2588 AC 3)", () => {
    it("pulses the pack strip when a pack lands on a player who is not looking", () => {
        const { push } = renderTable("phone-portrait", {
            packSize: 0,
            poolLength: 1,
        });
        fireEvent.click(dropZones()[0]!);
        expect(
            document
                .querySelector("[data-slot=draft-pack-status]")!
                .getAttribute("data-pulsing")
        ).toBeNull();

        push({ packSize: 3, poolLength: 1 });

        expect(
            document
                .querySelector("[data-slot=draft-pack-status]")!
                .getAttribute("data-pulsing")
        ).toBe("true");
    });

    it("does NOT pulse when the player is already on the pack", () => {
        const { push } = renderTable("phone-portrait", {
            packSize: 0,
            poolLength: 1,
        });
        push({ packSize: 3, poolLength: 1 });
        expect(
            document
                .querySelector("[data-slot=draft-pack-status]")!
                .getAttribute("data-pulsing")
        ).toBeNull();
    });

    it("drops the pulse to a static ring under reduced motion", () => {
        reduceMotionMock.mockReturnValue(true);
        const { push } = renderTable("phone-portrait", {
            packSize: 0,
            poolLength: 1,
        });
        fireEvent.click(dropZones()[0]!);
        push({ packSize: 3, poolLength: 1 });
        const bar = document.querySelector("[data-slot=draft-pack-status]")!;
        expect(bar.getAttribute("data-pulsing")).toBe("true");
        expect(bar.className).toContain("ring-accent");
        expect(bar.className).not.toContain("animate-pulse");
    });
});

describe("auto-snap back to the pack (issue #2588 AC 3)", () => {
    afterEach(() => vi.useRealTimers());

    it("pulls the view back inside the last ten seconds of a live timer", () => {
        vi.useFakeTimers();
        const now = Date.now();
        renderTable("phone-portrait", {
            poolLength: 1,
            pickDeadline: now + 5_000,
        });
        fireEvent.click(dropZones()[0]!);
        expect(scroller().dataset.stop).toBe("pool");
        act(() => vi.advanceTimersByTime(1_000));
        expect(scroller().dataset.stop).toBe("pack");
    });

    it("leaves a player alone on a timer-less event", () => {
        vi.useFakeTimers();
        renderTable("phone-portrait", { poolLength: 1 });
        fireEvent.click(dropZones()[0]!);
        act(() => vi.advanceTimersByTime(60_000));
        expect(scroller().dataset.stop).toBe("pool");
    });

    it("leaves a player alone while there is time to spare", () => {
        vi.useFakeTimers();
        const now = Date.now();
        renderTable("phone-portrait", {
            poolLength: 1,
            pickDeadline: now + 40_000,
        });
        fireEvent.click(dropZones()[0]!);
        act(() => vi.advanceTimersByTime(5_000));
        expect(scroller().dataset.stop).toBe("pool");
    });
});

describe("the pack grid's density toggle (issue #2588, ADR 0101 §6)", () => {
    it("draws 3×5 in portrait and switches to 4×4", () => {
        renderTable("phone-portrait", { packSize: 15 });
        const toggle = () =>
            document.querySelector("[data-slot=draft-density-toggle]")!;
        const grid = () =>
            document.querySelector("[data-slot=draft-pack-grid]")!;
        expect(toggle().textContent).toBe("3×5");
        expect(grid().getAttribute("data-columns")).toBe("3");

        fireEvent.click(toggle());

        expect(toggle().textContent).toBe("4×4");
        expect(grid().getAttribute("data-columns")).toBe("4");
    });

    it("draws 8×2 in landscape", () => {
        renderTable("phone-landscape", { packSize: 15 });
        expect(
            document.querySelector("[data-slot=draft-density-toggle]")!
                .textContent
        ).toBe("8×2");
        expect(
            document
                .querySelector("[data-slot=draft-pack-grid]")!
                .getAttribute("data-columns")
        ).toBe("8");
    });

    it("leaves the desktop grid on its auto-fill tracks and its zoom slider", () => {
        renderTable("split", { packSize: 15 });
        expect(
            document.querySelector("[data-slot=draft-density-toggle]")
        ).toBeNull();
        expect(
            document
                .querySelector("[data-slot=draft-pack-grid]")!
                .getAttribute("data-columns")
        ).toBeNull();
    });
});

describe("the swipe chevron respects reduced motion (issue #2588 AC 4)", () => {
    it("animates by default", () => {
        renderTable("phone-portrait");
        const chevron = document.querySelector("[data-draft-chevron]")!;
        expect(chevron.getAttribute("data-draft-chevron")).toBe("up");
        expect(chevron.getAttribute("data-animated")).toBe("true");
    });

    it("still RENDERS under reduced motion, without opting into the animation", () => {
        reduceMotionMock.mockReturnValue(true);
        renderTable("phone-portrait");
        const chevron = document.querySelector("[data-draft-chevron]")!;
        expect(chevron).toBeTruthy();
        expect(chevron.getAttribute("data-animated")).toBeNull();
    });

    it("points left in landscape, where the other pane is sideways", () => {
        renderTable("phone-landscape");
        expect(
            document
                .querySelector("[data-draft-chevron]")!
                .getAttribute("data-draft-chevron")
        ).toBe("left");
    });
});
