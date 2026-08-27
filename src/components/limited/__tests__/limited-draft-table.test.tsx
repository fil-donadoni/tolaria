// Draft pick gestures through the REAL projection (ADR 0060, issue #1248,
// seam 3; re-worked for the desktop card-context-menu regime by issue #2861).
// Drives `LimitedDraftTable` from a `limitedEvents` row through
// `projectLimitedEvent` — the same wire the client actually receives (per
// `.claude/rules/gre-development.md`'s "Frontend wiring analysis": a
// hand-built view masks a dropped field).
//
// `layout` decides the GESTURE regime independently of `useViewportMode()`
// (`stubViewport` below, which only affects the Peek Panel reserve AXIS on
// the phone path): the default (`"stacked"`, omitted) is the DESKTOP regime
// issue #2861 introduces — a card context menu, no Peek rail at all; passing
// `layout: "phone-portrait"` / `"phone-landscape"` reaches the PHONE regime,
// which issue #2861 leaves unchanged (the strip CTA row, the Pool/Sideboard
// `DeckZonePeek`).
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
    within,
    act,
} from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import {
    PEEK_PANEL_RAIL_WIDTH,
    PEEK_PANEL_SHEET_RESERVE,
} from "~/components/editing/usePeekPanelLayout";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import {
    dragOnto,
    installDndJsdomShims,
} from "~/components/deckbuilder/__tests__/dragHarness";
import { paneOf } from "~/components/deckbuilder/__tests__/zoneQueries";
import LimitedDraftTable from "../limited-draft-table";

// A real dnd-kit drag (`dragOnto`, driven through the REAL droppable
// registry rather than synthetic pointer coordinates — jsdom has no layout)
// needs a few browser APIs jsdom does not implement. Installed once: it only
// sets fallbacks (`matches: false` when nothing else stubs `matchMedia`,
// `elementFromPoint`, `getAnimations`), so it changes nothing for every other
// test in this file, which already runs with no `matchMedia` at all
// (`useViewportMode` falls back to `"desktop"` either way — see
// `stubViewport`'s own doc comment above).
beforeAll(() => installDndJsdomShims());

// LimitedDraftTable mounts LimitedDraftTimer (issue #2238), which reads
// `useReducedMotion` from `motion/react` — jsdom has no `matchMedia`, so
// every test here needs the same stub the timer's own test file uses.
vi.mock("motion/react", () => ({
    useReducedMotion: () => false,
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

/** `useViewportMode` reads two media queries and happy-dom has no
 *  `matchMedia` at all, so every test in this file runs in whichever regime
 *  the fallback happens to pick — which is `"desktop"`, i.e. the RAIL. That is
 *  exactly how a reserve once shipped on the wrong axis: a test named
 *  "reserves room for the sheet" ran in the configuration where it did
 *  nothing (issue #2583 review). Stub the queries so both branches are
 *  reachable. Module-scoped (not a per-`describe` helper) so every describe
 *  block below can reach the phone/sheet regime. */
function stubViewport(mode: "portrait" | "landscape") {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches:
            mode === "portrait"
                ? query.includes("orientation: portrait")
                : query.includes("max-height: 500px"),
        addEventListener() {},
        removeEventListener() {},
    }));
}

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
            createLimitedEvent: "createLimitedEvent",
            joinLimitedEvent: "joinLimitedEvent",
            startLimitedEvent: "startLimitedEvent",
            submitPick: "submitPick",
            setPoolArrangementEntry: "setPoolArrangementEntry",
            selectDraftPick: "selectDraftPick",
        },
    },
}));

beforeEach(() => {
    vi.clearAllMocks();
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

afterEach(() => {
    cleanup();
    // `stubViewport` (module-scoped, used by several describe blocks below)
    // stubs `matchMedia` globally — a no-op here when nothing was stubbed,
    // and otherwise what stops one test's viewport regime leaking into the
    // next.
    vi.unstubAllGlobals();
    // A couple of describe blocks use fake timers for the Pool/Sideboard
    // menu's own open delay (issue #2861) — always restore real ones so a
    // forgotten `vi.useRealTimers()` in one test can never leak into the next.
    vi.useRealTimers();
});

type EventRowOverrides = {
    selectedPickId?: string;
    poolLength?: number;
    pickDeadline?: number;
    /** Explicit Pool, overriding the auto-generated all-Bolt one — the
     *  Pool/Sideboard tests need a SECOND distinct card (a land) so Grouping
     *  `mv`'s default view produces more than one Column to "Move to…"
     *  between. */
    pool?: { scryfallId: string; cardId: string; cardName: string }[];
    poolArrangement?: LimitedEventRow["seats"][number]["poolArrangement"];
};

function eventRow(overrides: EventRowOverrides): LimitedEventRow {
    const poolLength = overrides.poolLength ?? 0;
    const pool =
        overrides.pool ??
        Array.from({ length: poolLength }, (_, i) => ({
            scryfallId: `s-existing-${i}`,
            cardId: BOLT_ID,
            cardName: "Lightning Bolt",
        }));
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
                pool,
                currentPack: [
                    {
                        scryfallId: "s1",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                        pickId: "r0-p0-c0",
                    },
                    {
                        scryfallId: "s2",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                        pickId: "r0-p0-c1",
                    },
                ],
                selectedPickId: overrides.selectedPickId,
                pickDeadline: overrides.pickDeadline,
                poolArrangement: overrides.poolArrangement,
            },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function renderTable(
    overrides: EventRowOverrides,
    manager?: DragDropManager,
    layout?: "stacked" | "phone-portrait" | "phone-landscape"
) {
    const view = projectLimitedEvent(eventRow(overrides), "user1");
    const seat = view.seats.find((s) => s.seatIndex === 0)!;
    // `projectLimitedEvent`'s pure return type has no `autoBuiltDeck` — that
    // field is zipped in separately by `projectEventForViewer`
    // (`convex/limitedEvents.ts`) and only exists on the real wire type
    // (`LimitedEventSeatView`, from the generated query). Stub it so the
    // fixture satisfies `LimitedDraftTable`'s prop type without pulling in
    // the whole Convex query machinery just for this seam-3 test.
    const seatView = { ...seat, autoBuiltDeck: null };
    return render(
        <LimitedDraftTable
            eventId={"event-1" as never}
            seat={seatView}
            round={0}
            // `manager` is only ever supplied by a test that needs to drive a
            // REAL drag (`dragOnto`) — omitted, `LimitedDraftTable` mints its
            // own private one, exactly as the app does.
            manager={manager}
            layout={layout}
        />
    );
}

const menu = () => document.querySelector('[role="menu"]');
const menuItems = () =>
    [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];

describe("LimitedDraftTable Booster gestures — desktop regime (default, issue #2861)", () => {
    it("a single click SELECTS the card and opens the pack menu with Pick / → Side / Inspect", () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c0",
        });
        expect(submitPickMock).not.toHaveBeenCalled();
        expect(menu()).toBeTruthy();
        expect(menu()!.getAttribute("aria-label")).toBe(
            "Booster 1 pick actions"
        );
        expect(menuItems().map((el) => el.textContent)).toEqual([
            "Pick",
            "→ Side",
            "Inspect",
        ]);
    });

    it("double click has no effect — double-click-to-pick is retired on desktop", () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.doubleClick(cards[0]);
        expect(submitPickMock).not.toHaveBeenCalled();
        expect(menu()).toBeNull();
    });

    it('the menu\'s "Pick" commits the Pick', async () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        fireEvent.click(menuItems().find((el) => el.textContent === "Pick")!);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        expect(menu()).toBeNull();
    });

    it('the menu\'s "→ Side" commits the Pick AND sideboards the new Pool card at the resolved poolIndex', async () => {
        // The seat already has 3 Pool cards — the new pick lands at index 3.
        const { getAllByRole } = renderTable({ poolLength: 3 });
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        fireEvent.click(menuItems().find((el) => el.textContent === "→ Side")!);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        await waitFor(() =>
            expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
                eventId: "event-1",
                poolIndex: 3,
                sideboard: true,
            })
        );
    });

    it('the menu\'s "Inspect" opens the Inspect Overlay, whose own "Pick" commits and closes it', async () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        fireEvent.click(
            menuItems().find((el) => el.textContent === "Inspect")!
        );
        expect(menu()).toBeNull();
        const overlay = document.querySelector("[data-inspect-panel]");
        expect(overlay).toBeTruthy();

        const overlayActionEls = () =>
            [
                ...document.querySelectorAll(
                    "[data-inspect-panel] [data-editing-action]"
                ),
            ] as HTMLElement[];
        expect(
            overlayActionEls().map((el) => el.dataset.editingAction)
        ).toEqual(["Pick", "→ Side"]);
        fireEvent.click(overlayActionEls()[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        expect(document.querySelector("[data-inspect-panel]")).toBeNull();
    });

    it("a right click opens the Inspect Overlay directly, with no menu at all", () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        expect(menu()).toBeNull();
        expect(document.querySelector("[data-inspect-panel]")).toBeTruthy();
    });

    it("the seat's selectedPickId (through the real projection) renders that exact card highlighted", () => {
        const { getAllByRole } = renderTable({ selectedPickId: "r0-p0-c1" });
        const cards = getAllByRole("button", { name: /Draft pick/ });
        const pressedStates = cards.map((c) => c.getAttribute("aria-pressed"));
        expect(pressedStates.filter((p) => p === "true")).toHaveLength(1);
    });

    // Issue #2238: the Pick Timer used to render inline in the meta row and
    // this suite never exercised a non-null `pickDeadline` at all. Assert it
    // mounts (through the real projection, seam 3) once the seat carries one.
    it("mounts the Pick Timer above the Booster when the seat has a pickDeadline", () => {
        const { getByRole } = renderTable({ pickDeadline: Date.now() + 5000 });
        expect(getByRole("timer").textContent).toMatch(/left|Auto-picking/);
    });

    // Issue #2861's whole point: no reserved-space toggle, ever, on this
    // regime — no `[data-peek-panel]` and no padding change on select.
    it("reserves nothing for a selection — no Peek rail mounts in the desktop regime", () => {
        const { container, getAllByRole } = renderTable({});
        const surface = () =>
            container.querySelector("[data-slot=draft-surface]") as HTMLElement;
        expect(surface().style.paddingRight).toBe("");
        expect(surface().style.paddingBottom).toBe("");

        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        expect(surface().style.paddingRight).toBe("");
        expect(surface().style.paddingBottom).toBe("");
        expect(document.querySelector("[data-peek-panel]")).toBeNull();
    });
});

describe("LimitedDraftTable Booster gestures — phone regime (unchanged, ADR 0060/#2588)", () => {
    it("a single click on a Booster card SELECTS it and never commits", () => {
        const { getAllByRole } = renderTable({}, undefined, "phone-portrait");
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c0",
        });
        expect(submitPickMock).not.toHaveBeenCalled();
        expect(menu()).toBeNull();
    });

    it("a double click on a Booster card commits the Pick", async () => {
        const { getAllByRole } = renderTable({}, undefined, "phone-portrait");
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.doubleClick(cards[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
    });

    it('the context menu\'s "Pick" commits the Pick', async () => {
        const { getAllByRole, getByRole } = renderTable(
            {},
            undefined,
            "phone-portrait"
        );
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        fireEvent.click(getByRole("menuitem", { name: "Pick" }));
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
    });

    it('the context menu\'s "Pick to sideboard" commits the Pick AND sideboards the new Pool card at the resolved poolIndex', async () => {
        const { getAllByRole, getByRole } = renderTable(
            { poolLength: 3 },
            undefined,
            "phone-portrait"
        );
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        fireEvent.click(getByRole("menuitem", { name: "Pick to sideboard" }));

        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        await waitFor(() =>
            expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
                eventId: "event-1",
                poolIndex: 3,
                sideboard: true,
            })
        );
    });

    it("a right click never selects or commits by itself — only opens the menu", () => {
        const { getAllByRole } = renderTable({}, undefined, "phone-portrait");
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        expect(selectDraftPickMock).not.toHaveBeenCalled();
        expect(submitPickMock).not.toHaveBeenCalled();
    });
});

// The phone strip's CTA row (PRD #2405 D16, issue #2583/#2588) — unchanged by
// issue #2861, which only retires the DESKTOP arm of this same selection.
describe("LimitedDraftTable phone strip CTA row (PRD #2405 D16, issue #2583/#2588)", () => {
    const actionEls = () =>
        [
            ...document.querySelectorAll("[data-editing-action]"),
        ] as HTMLElement[];
    const overlayActionEls = () =>
        [
            ...document.querySelectorAll(
                "[data-inspect-panel] [data-editing-action]"
            ),
        ] as HTMLElement[];

    it("a selected card's CTA row carries Pick / → Side / Inspect", () => {
        renderTable(
            { selectedPickId: "r0-p0-c1" },
            undefined,
            "phone-portrait"
        );
        expect(actionEls().map((el) => el.dataset.editingAction)).toEqual([
            "Pick",
            "→ Side",
            "Inspect",
        ]);
    });

    it("the row's primary CTA commits the SELECTED pick", async () => {
        renderTable(
            { selectedPickId: "r0-p0-c1" },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(actionEls()[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c1",
            })
        );
    });

    it('the row\'s "Inspect" CTA opens the Inspect Overlay', () => {
        renderTable(
            { selectedPickId: "r0-p0-c0" },
            undefined,
            "phone-portrait"
        );
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
        fireEvent.click(actionEls()[2]);
        const overlay = document.querySelector("[data-inspect-panel]");
        expect(overlay).toBeTruthy();
        expect((overlay as HTMLElement).style.maxHeight).toBe(
            "calc(100dvh - 1.5rem)"
        );
    });

    it("the Inspect Overlay drops the Inspect CTA and closes after the primary fires", async () => {
        renderTable(
            { selectedPickId: "r0-p0-c0" },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(actionEls()[2]); // "Inspect"
        expect(document.querySelector("[data-inspect-panel]")).toBeTruthy();
        expect(
            overlayActionEls().map((el) => el.dataset.editingAction)
        ).toEqual(["Pick", "→ Side"]);

        fireEvent.click(overlayActionEls()[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        expect(document.querySelector("[data-inspect-panel]")).toBeNull();
    });
});

// Issue #2861: the desktop Pool/Sideboard menu — a click opens it on a short
// delay (the double-click window), a double click cancels that and moves the
// card instead, a real right-click opens the Inspect Overlay directly.
describe("LimitedDraftTable Pool/Sideboard desktop menu (issue #2861)", () => {
    const boltInPool = [
        { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    ];

    beforeEach(() => vi.useFakeTimers());

    it("a click opens the menu after the double-click window, with → Side / Move to… / Inspect for a Pool card", () => {
        const { getByTitle } = renderTable({ pool: boltInPool });
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(menu()).toBeNull(); // not yet — still inside the delay window
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(menu()).toBeTruthy();
        expect(menu()!.getAttribute("aria-label")).toBe("Pool card actions");
        expect(menuItems().map((el) => el.textContent)).toEqual([
            "→ Side",
            "Move to…",
            "Inspect",
        ]);
    });

    it('the same holds for a Sideboard card, minus "Move to…" (the Sideboard has no Columns to pin into)', () => {
        const { getByTitle } = renderTable({
            pool: boltInPool,
            poolArrangement: [{ poolIndex: 0, sideboard: true }],
        });
        fireEvent.click(getByTitle(/from the Sideboard/));
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(menu()!.getAttribute("aria-label")).toBe(
            "Sideboard card actions"
        );
        expect(menuItems().map((el) => el.textContent)).toEqual([
            "→ Pool",
            "Inspect",
        ]);
    });

    it('the menu\'s "→ Side" moves the card to the Sideboard', () => {
        const { getByTitle } = renderTable({ pool: boltInPool });
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        act(() => {
            vi.advanceTimersByTime(200);
        });
        fireEvent.click(menuItems().find((el) => el.textContent === "→ Side")!);
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: true,
        });
        expect(menu()).toBeNull();
    });

    it('the menu\'s "Move to…" opens an ActionSheet of Column destinations, and choosing one pins the card', () => {
        const { getByTitle, getByRole } = renderTable({
            pool: [
                ...boltInPool,
                { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
            ],
        });
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        act(() => {
            vi.advanceTimersByTime(200);
        });
        fireEvent.click(
            menuItems().find((el) => el.textContent === "Move to…")!
        );
        expect(menu()).toBeNull();
        // The Bolt defaults into "MV 1" (`mv:1`); moving it into the OTHER
        // generated Column this pool has (`mv:lands`, the Plains' own) is
        // what proves the Pin actually names a DIFFERENT Column.
        fireEvent.click(getByRole("button", { name: "Lands" }));
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "mv:lands",
        });
    });

    it('the menu\'s "Inspect" opens the Inspect Overlay with the zone-move CTA', () => {
        const { getByTitle } = renderTable({ pool: boltInPool });
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        act(() => {
            vi.advanceTimersByTime(200);
        });
        fireEvent.click(
            menuItems().find((el) => el.textContent === "Inspect")!
        );
        expect(menu()).toBeNull();
        const overlayActionEls = () =>
            [
                ...document.querySelectorAll(
                    "[data-inspect-panel] [data-editing-action]"
                ),
            ] as HTMLElement[];
        expect(document.querySelector("[data-inspect-panel]")).toBeTruthy();
        expect(
            overlayActionEls().map((el) => el.dataset.editingAction)
        ).toEqual(["→ Side"]);
    });

    it("a real right click opens the Inspect Overlay directly, with no menu", () => {
        const { getByTitle } = renderTable({ pool: boltInPool });
        fireEvent.contextMenu(getByTitle(/^Remove Lightning Bolt/));
        expect(menu()).toBeNull();
        expect(document.querySelector("[data-inspect-panel]")).toBeTruthy();
    });

    // The load-bearing regression this AC calls out by name: a browser fires
    // click, click, dblclick — so a naive "open on click" would flash the
    // menu open before the move ever lands. A double click must cancel the
    // pending open outright.
    it("a double click moves the card immediately and never leaves the menu open", () => {
        const { getByTitle } = renderTable({ pool: boltInPool });
        const tile = getByTitle(/^Remove Lightning Bolt/);
        fireEvent.click(tile);
        fireEvent.doubleClick(tile);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(menu()).toBeNull();
        expect(setPoolArrangementEntryMock).toHaveBeenCalledTimes(1);
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: true,
        });
    });

    it("a double click on a Sideboard card moves it back to the Pool with no Card Pin", () => {
        const { getByTitle } = renderTable({
            pool: boltInPool,
            poolArrangement: [{ poolIndex: 0, sideboard: true }],
        });
        const tile = getByTitle(/from the Sideboard/);
        fireEvent.click(tile);
        fireEvent.doubleClick(tile);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(menu()).toBeNull();
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: false,
        });
        // No `column` field at all — the move must never assert a Pin.
        const [args] = setPoolArrangementEntryMock.mock.calls.at(-1)!;
        expect(args).not.toHaveProperty("column");
    });

    // The unmount-mid-timer hazard `deck-card-tile.tsx`'s own doc comment
    // warns about (PR #2641): a pending action owned by a component that
    // unmounts must not throw or leak a `setState` after unmount.
    it("unmounting with a pending menu-open timer does not throw", () => {
        const { getByTitle, unmount } = renderTable({ pool: boltInPool });
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(() => unmount()).not.toThrow();
        expect(() => act(() => vi.advanceTimersByTime(1000))).not.toThrow();
    });
});

// Issue #2667 (unchanged by issue #2861, which only retires the DESKTOP arm
// of this selection): the Pool/Sideboard half of the PHONE selection model,
// reusing `DeckZonePeek` byte-for-byte from the deckbuilder.
describe("LimitedDraftTable Pool/Sideboard phone Peek Panel (issue #2667)", () => {
    const panels = () =>
        [...document.querySelectorAll("[data-peek-panel]")] as HTMLElement[];
    const actionEls = () =>
        [
            ...document.querySelectorAll("[data-editing-action]"),
        ] as HTMLElement[];
    const boltInPool = [
        { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    ];

    it("tapping a Pool card opens the Peek Panel targeted at that card, with Inspect in its CTA row", () => {
        const { getByTitle } = renderTable(
            { pool: boltInPool },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(panels()).toHaveLength(1);
        expect(panels()[0].getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );
        expect(actionEls().map((el) => el.dataset.editingAction)).toContain(
            "Inspect"
        );
    });

    it("the same holds for a card in the Sideboard", () => {
        const { getByTitle } = renderTable(
            {
                pool: boltInPool,
                poolArrangement: [{ poolIndex: 0, sideboard: true }],
            },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(getByTitle(/from the Sideboard/));
        expect(panels()).toHaveLength(1);
        expect(panels()[0].getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );
        expect(actionEls().map((el) => el.dataset.editingAction)).toEqual([
            "→ Pool",
            "Inspect",
        ]);
    });

    it("Inspect from a Pool selection opens the full card read; closing it returns to the Draft Room with the selection intact", () => {
        const { getByTitle } = renderTable(
            { pool: boltInPool },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        fireEvent.click(
            actionEls().find((el) => el.dataset.editingAction === "Inspect")!
        );
        expect(document.querySelector("[data-inspect-panel]")).toBeTruthy();

        fireEvent.click(
            document.querySelector('[aria-label="Close inspect overlay"]')!
        );
        expect(document.querySelector("[data-inspect-panel]")).toBeNull();
        // The selection survives closing the OVERLAY — the panel underneath
        // is still showing the same card.
        expect(panels()).toHaveLength(1);
        expect(panels()[0].getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );
    });

    // On PHONE the Booster's own selection never gets a fixed panel at all
    // (it inlines into the strip, unchanged) — so the only panel that can
    // ever mount here is the Pool's. This still proves the cross-clearing
    // this describe block is named for: a Pool selection clears the
    // Booster's SERVER-side selection, and picking a Booster card clears the
    // Pool's own local one.
    it("selecting a Pool card while a pack card is selected clears the pack's server-side selection, and picking a Booster card closes the Pool panel", () => {
        const { getByTitle, getAllByRole } = renderTable(
            {
                selectedPickId: "r0-p0-c0", // pack: "Lightning Bolt"
                pool: [
                    { scryfallId: "s1", cardId: PLAINS_ID, cardName: "Plains" },
                ],
            },
            undefined,
            "phone-portrait"
        );
        expect(panels()).toHaveLength(0);

        fireEvent.click(getByTitle(/^Remove Plains/));
        expect(panels()).toHaveLength(1);
        expect(panels()[0].getAttribute("aria-label")).toBe(
            "Selected card: Plains"
        );
        // The pack's own server-side selection is cleared, not merely hidden.
        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: null,
        });

        // …and back the other way: picking a Booster card closes the Pool
        // panel — the Pool's own local selection is cleared.
        const boosterCards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(boosterCards[0]);
        expect(panels()).toHaveLength(0);
    });

    it("moving a Pool card to a specific Column from the panel persists the same Pool Arrangement entry a long-press drag onto that Column persists, without asserting the Zone", () => {
        const { getByTitle, getByRole } = renderTable(
            {
                pool: [
                    ...boltInPool,
                    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
                ],
            },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        fireEvent.click(
            actionEls().find((el) => el.dataset.editingAction === "Move to…")!
        );
        fireEvent.click(getByRole("button", { name: "Lands" }));
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "mv:lands",
        });
    });

    it("zone moves (Pool <-> Sideboard) from the panel persist and are reflected in the Main / Sideboard counts", () => {
        const { getByTitle } = renderTable(
            { pool: boltInPool },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        fireEvent.click(
            actionEls().find((el) => el.dataset.editingAction === "→ Side")!
        );
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: true,
        });
    });

    it("→ Side clears the Pool selection so the panel cannot be walked into the stale-selection trap", () => {
        const { getByTitle } = renderTable(
            {
                pool: [
                    ...boltInPool,
                    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
                ],
            },
            undefined,
            "phone-portrait"
        );
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(panels()).toHaveLength(1);

        fireEvent.click(
            actionEls().find((el) => el.dataset.editingAction === "→ Side")!
        );
        expect(setPoolArrangementEntryMock).toHaveBeenLastCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: true,
        });

        expect(panels()).toHaveLength(0);
        expect(
            actionEls().find((el) => el.dataset.editingAction === "Move to…")
        ).toBeUndefined();
        expect(setPoolArrangementEntryMock).toHaveBeenCalledTimes(1);
    });

    it("a DRAG to the Sideboard, with the panel still open, does not let a follow-up 'Move to…' pin pull the card back out of the Sideboard", async () => {
        const manager = new DragDropManager();
        const { container, getByTitle, getByRole } = renderTable(
            {
                pool: [
                    ...boltInPool,
                    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
                ],
            },
            manager,
            "phone-portrait"
        );

        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(panels()).toHaveLength(1);

        const pool = paneOf(container, /^Pool 2/);
        const sideboardPane = paneOf(container, /^Sideboard 0/);
        await dragOnto(
            manager,
            within(pool).getByTitle(/^Remove Lightning Bolt/),
            sideboardPane
        );
        expect(setPoolArrangementEntryMock).toHaveBeenLastCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            sideboard: true,
        });

        expect(panels()).toHaveLength(1);
        const moveTo = actionEls().find(
            (el) => el.dataset.editingAction === "Move to…"
        );
        expect(moveTo).toBeTruthy();
        fireEvent.click(moveTo!);
        fireEvent.click(getByRole("button", { name: "Lands" }));

        for (const [args] of setPoolArrangementEntryMock.mock.calls) {
            expect((args as { sideboard?: boolean }).sideboard).not.toBe(false);
        }
        expect(setPoolArrangementEntryMock).toHaveBeenLastCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "mv:lands",
        });
    });

    it("reserves the rail's WIDTH for the Pool's panel in landscape", () => {
        stubViewport("landscape");
        // `layout="phone-portrait"` (not `"phone-landscape"`) so the actual
        // `LimitedDraftPool` tiles are reachable at all — the landscape ARM
        // renders a compact sneak-peek strip instead of the full Pool grid.
        // `useViewportMode()` (which `stubViewport` controls, and which
        // decides the reserve AXIS below) is a media query wholly independent
        // of this `layout` prop, so this combination still exercises the
        // rail axis honestly.
        const { container, getByTitle } = renderTable(
            { pool: boltInPool },
            undefined,
            "phone-portrait"
        );
        const surface = () =>
            container.querySelector("[data-slot=draft-surface]") as HTMLElement;
        expect(surface().style.paddingRight).toBe("");
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(surface().style.paddingRight).toBe(PEEK_PANEL_RAIL_WIDTH);
    });

    it("reserves the sheet's HEIGHT for the Pool's panel in portrait", () => {
        stubViewport("portrait");
        const { container, getByTitle } = renderTable(
            { pool: boltInPool },
            undefined,
            "phone-portrait"
        );
        const surface = () =>
            container.querySelector("[data-slot=draft-surface]") as HTMLElement;
        expect(surface().style.paddingBottom).toBe("");
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(surface().style.paddingBottom).toBe(PEEK_PANEL_SHEET_RESERVE);
        expect(surface().style.paddingRight).toBe("");
    });
});

// Keyboard picking (ADR 0101 §6, issue #2587). The point of these is not that
// a key does something — it is that the key goes through the SAME handlers
// the click, the context menu, the Peek Panel CTA row and the drag use, so
// there is exactly one definition of what a pick is. Asserting on the
// MUTATIONS (rather than on a local highlight) is what makes that structural.
describe("LimitedDraftTable keyboard picking (issue #2587)", () => {
    it("arrows move the SERVER-side selection, starting at the first card", () => {
        renderTable({});

        fireEvent.keyDown(window, { key: "ArrowRight" });

        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c0",
        });
        expect(submitPickMock).not.toHaveBeenCalled();
    });

    it("arrows wrap around the pack rather than stopping at its ends", () => {
        renderTable({ selectedPickId: "r0-p0-c0" });

        fireEvent.keyDown(window, { key: "ArrowLeft" });

        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c1",
        });
    });

    it("Enter commits the Selected Card through submitPick", async () => {
        renderTable({ selectedPickId: "r0-p0-c1" });

        fireEvent.keyDown(window, { key: "Enter" });

        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c1",
            })
        );
    });

    it("S commits it to the sideboard — the same pick plus the arrangement write", async () => {
        renderTable({ selectedPickId: "r0-p0-c1", poolLength: 2 });

        fireEvent.keyDown(window, { key: "s" });

        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c1",
            })
        );
        await waitFor(() =>
            expect(setPoolArrangementEntryMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventId: "event-1",
                    poolIndex: 2,
                    sideboard: true,
                })
            )
        );
    });

    it("ignores a keystroke typed into a field, and Enter with nothing selected", () => {
        const { container } = renderTable({});
        const input = document.createElement("input");
        container.appendChild(input);

        fireEvent.keyDown(input, { key: "ArrowRight" });
        fireEvent.keyDown(window, { key: "Enter" });

        expect(selectDraftPickMock).not.toHaveBeenCalled();
        expect(submitPickMock).not.toHaveBeenCalled();
    });
});
