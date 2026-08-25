// Draft pick gestures through the REAL projection (ADR 0060, issue #1248,
// seam 3). Drives `LimitedDraftTable` from a `limitedEvents` row through
// `projectLimitedEvent` — the same wire the client actually receives (per
// `.claude/rules/gre-development.md`'s "Frontend wiring analysis": a
// hand-built view masks a dropped field). Proves: single click selects and
// NEVER commits; double click / the context-menu commit; "Pick to
// sideboard" composes submitPick + setPoolArrangementEntry with the
// resolved poolIndex; a selected card renders highlighted.
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
 *  block below — including the Pool/Sideboard one added by issue #2667 — can
 *  reach the phone/sheet regime, not only the Booster's own Peek Panel suite. */
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
});

type EventRowOverrides = {
    selectedPickId?: string;
    poolLength?: number;
    pickDeadline?: number;
    /** Explicit Pool, overriding the auto-generated all-Bolt one — issue
     *  #2667's Pool/Sideboard tests need a SECOND distinct card (a land) so
     *  Grouping `mv`'s default view produces more than one Column to "Move
     *  to…" between. */
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

function renderTable(overrides: EventRowOverrides, manager?: DragDropManager) {
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
        />
    );
}

describe("LimitedDraftTable pick gestures through projectLimitedEvent (ADR 0060, issue #1248)", () => {
    it("a single click on a Booster card SELECTS it and never commits", () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c0",
        });
        expect(submitPickMock).not.toHaveBeenCalled();
    });

    it("a double click on a Booster card commits the Pick", async () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.doubleClick(cards[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
    });

    it("the seat's selectedPickId (through the real projection) renders that exact card highlighted", () => {
        const { getAllByRole } = renderTable({ selectedPickId: "r0-p0-c1" });
        const cards = getAllByRole("button", { name: /Draft pick/ });
        const pressedStates = cards.map((c) => c.getAttribute("aria-pressed"));
        expect(pressedStates.filter((p) => p === "true")).toHaveLength(1);
    });

    it('the context menu\'s "Pick" commits the Pick', async () => {
        const { getAllByRole, getByRole } = renderTable({});
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
        // The seat already has 3 Pool cards — the new pick lands at index 3.
        const { getAllByRole, getByRole } = renderTable({ poolLength: 3 });
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
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        expect(selectDraftPickMock).not.toHaveBeenCalled();
        expect(submitPickMock).not.toHaveBeenCalled();
    });

    // Issue #2238: the Pick Timer used to render inline in the meta row and
    // this suite never exercised a non-null `pickDeadline` at all. Assert it
    // mounts (through the real projection, seam 3) once the seat carries one.
    it("mounts the Pick Timer above the Booster when the seat has a pickDeadline", () => {
        const { getByRole } = renderTable({ pickDeadline: Date.now() + 5000 });
        expect(getByRole("timer").textContent).toMatch(/left|Auto-picking/);
    });
});

// The Draft Room is the FIRST adopter of the editing-surface gesture
// primitives (PRD #2405 D16, issue #2583), and it is the adopter because its
// tap ALREADY means "select" (ADR 0060 above) — the gesture core's `tap →
// select → Peek Panel` needs no change of meaning here. These run the full
// path — real projection → real table → real PeekPanel → real mutation mock —
// because the panel being correct in isolation says nothing about whether the
// surface ever renders it.
describe("LimitedDraftTable Peek Panel (PRD #2405 D16, issue #2583)", () => {
    const panel = () => document.querySelector("[data-peek-panel]");
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

    afterEach(() => vi.unstubAllGlobals());

    // `[data-slot]`, not a class list: the surface's classes are layout and
    // they changed the moment the Draft Room stopped being a block inside the
    // event page (issue #2587). A class-keyed selector went silently null
    // there, which reads as "no reserve" — the very bug these assert.
    const surfaceOf = (container: HTMLElement) =>
        container.querySelector("[data-slot=draft-surface]") as HTMLElement;

    it("shows no panel until a card is selected", () => {
        renderTable({});
        expect(panel()).toBeNull();
    });

    it("a selected card opens the panel with the Draft Room's CTA row", () => {
        renderTable({ selectedPickId: "r0-p0-c1" });
        expect(panel()).toBeTruthy();
        expect(panel()!.getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );
        expect(actionEls().map((el) => el.dataset.editingAction)).toEqual([
            "Pick",
            "→ Side",
            "Inspect",
        ]);
    });

    it("the panel's primary CTA commits the SELECTED pick", async () => {
        renderTable({ selectedPickId: "r0-p0-c1" });
        fireEvent.click(actionEls()[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c1",
            })
        );
    });

    it('the panel\'s "→ Side" CTA commits the Pick AND sideboards it', async () => {
        renderTable({ selectedPickId: "r0-p0-c0", poolLength: 2 });
        fireEvent.click(actionEls()[1]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        await waitFor(() =>
            expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
                eventId: "event-1",
                poolIndex: 2,
                sideboard: true,
            })
        );
    });

    it('the panel\'s "Inspect" CTA opens the Inspect Overlay', () => {
        renderTable({ selectedPickId: "r0-p0-c0" });
        expect(document.querySelector("[data-inspect-overlay]")).toBeNull();
        fireEvent.click(actionEls()[2]);
        const overlay = document.querySelector("[data-inspect-panel]");
        expect(overlay).toBeTruthy();
        expect((overlay as HTMLElement).style.maxHeight).toBe(
            "calc(100dvh - 1.5rem)"
        );
    });

    // The reserve has to be on the axis the RESOLVED panel layout eats. Both
    // branches, because only ONE of the five UI-gate viewports resolves to
    // the sheet: `useViewportMode`'s `"portrait"` is `(orientation: portrait)
    // and (max-width: 767px)`, so 1440×900, 844×390, 820×1180 and 1180×820
    // all render the RAIL — a `fixed top-0 right-0 bottom-0` strip that
    // occludes the right edge of the Booster grid and the Pool unless the
    // surface reserves WIDTH for it.
    it("reserves the sheet's HEIGHT in portrait, so it never covers the Pool", () => {
        stubViewport("portrait");
        const { container } = renderTable({ selectedPickId: "r0-p0-c0" });
        expect(panel()!.getAttribute("data-peek-panel")).toBe("sheet");
        expect(surfaceOf(container).style.paddingBottom).toBe(
            PEEK_PANEL_SHEET_RESERVE
        );
        expect(surfaceOf(container).style.paddingRight).toBe("");
    });

    it("reserves the rail's WIDTH in landscape, so it never covers the Booster grid", () => {
        stubViewport("landscape");
        const { container } = renderTable({ selectedPickId: "r0-p0-c0" });
        expect(panel()!.getAttribute("data-peek-panel")).toBe("rail");
        expect(surfaceOf(container).style.paddingRight).toBe(
            PEEK_PANEL_RAIL_WIDTH
        );
        expect(surfaceOf(container).style.paddingBottom).toBe("");
    });

    it("reserves the rail's WIDTH on desktop too — the default regime", () => {
        // No `matchMedia` at all: `useViewportMode` falls back to "desktop",
        // which is the rail. This is the configuration the ORIGINAL guarding
        // test ran in while asserting a bottom reserve.
        const { container } = renderTable({ selectedPickId: "r0-p0-c0" });
        expect(panel()!.getAttribute("data-peek-panel")).toBe("rail");
        expect(surfaceOf(container).style.paddingRight).toBe(
            PEEK_PANEL_RAIL_WIDTH
        );
    });

    it("reserves nothing at all while no card is selected", () => {
        const { container } = renderTable({});
        expect(surfaceOf(container).style.paddingRight).toBe("");
        expect(surfaceOf(container).style.paddingBottom).toBe("");
    });

    it("closing the panel leaves the card selected but the panel gone", () => {
        renderTable({ selectedPickId: "r0-p0-c0" });
        fireEvent.click(
            document.querySelector('[aria-label="Close Lightning Bolt panel"]')!
        );
        expect(panel()).toBeNull();
        // Closing is a dismissal, not a deselection: the Selected Card is what
        // a timer expiry auto-picks (issue #1249) and must survive it.
        expect(selectDraftPickMock).not.toHaveBeenCalled();
    });

    // The dismissal is remembered per pick id; a fresh select must supersede
    // it. Without that, tapping the SAME card again leaves
    // `peekClosedFor === selectedPickId` forever — and since this slice sets
    // `holdPreview={false}` on the pack card, that card would have no touch
    // read path left for the rest of the draft.
    it("re-tapping a card whose panel was dismissed brings the panel BACK", () => {
        const { getAllByRole } = renderTable({ selectedPickId: "r0-p0-c0" });
        fireEvent.click(
            document.querySelector('[aria-label="Close Lightning Bolt panel"]')!
        );
        expect(panel()).toBeNull();

        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]); // the same card — pickId r0-p0-c0
        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c0",
        });
        expect(panel()).toBeTruthy();
    });

    // The overlay's own CTA row is NOT the panel's: "Inspect" would be a
    // silent no-op inside the thing it opens, and a "Pick" that does not
    // dismiss leaves a full-screen card over the next pack.
    it("the Inspect Overlay drops the Inspect CTA and closes after the primary fires", async () => {
        renderTable({ selectedPickId: "r0-p0-c0" });
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

// Issue #2667: the Pool/Sideboard half of the ONE selection model, reusing
// `DeckZonePeek` byte-for-byte from the deckbuilder rather than a second
// "Move to…"/Inspect implementation. Run through the real projection → real
// `LimitedDraftTable` → real `LimitedDraftPool` → real `DeckZoneSurface`, same
// discipline as the Booster's own Peek Panel suite above — the panel being
// correct in isolation says nothing about whether this surface ever mounts it.
describe("LimitedDraftTable Pool/Sideboard Peek Panel (issue #2667)", () => {
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
        const { getByTitle } = renderTable({ pool: boltInPool });
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
        const { getByTitle } = renderTable({
            pool: boltInPool,
            poolArrangement: [{ poolIndex: 0, sideboard: true }],
        });
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
        const { getByTitle } = renderTable({ pool: boltInPool });
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

    it("selecting a Pool card while a pack card is selected clears the pack selection, and vice versa — at no point are two panels mounted", () => {
        const { getByTitle, getAllByRole } = renderTable({
            selectedPickId: "r0-p0-c0", // pack: "Lightning Bolt"
            pool: [{ scryfallId: "s1", cardId: PLAINS_ID, cardName: "Plains" }],
        });
        expect(panels()).toHaveLength(1);
        expect(panels()[0].getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );

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

        // …and back the other way: picking a Booster card while the Pool
        // panel is open clears the Pool's own local selection.
        const boosterCards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(boosterCards[0]);
        expect(panels()).toHaveLength(1);
        expect(panels()[0].getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );
    });

    // Issue #2667 round 3 (PR #2797 review round 2): a column pin from the
    // panel used to send `sideboard: false` unconditionally, on the
    // assumption a Pool selection can never go stale about its own Zone — an
    // assumption a concurrent drag breaks (see the DRAG regression test
    // below). The pin now sends NO `sideboard` field at all — "don't touch
    // the Zone", the same contract the build view's own `handlePin`
    // (`pool-deck-builder-form.tsx`) has always used for a pin — so the
    // resolved Arrangement below still comes out unsideboarded, but via
    // "never asserted" rather than "explicitly asserted false".
    it("moving a Pool card to a specific Column from the panel persists the same Pool Arrangement entry a long-press drag onto that Column persists, without asserting the Zone", () => {
        const { getByTitle, getByRole } = renderTable({
            pool: [
                ...boltInPool,
                { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
            ],
        });
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        fireEvent.click(
            actionEls().find((el) => el.dataset.editingAction === "Move to…")!
        );
        // The Bolt defaults into "MV 1" (`mv:1`); moving it into the OTHER
        // generated Column this pool has (`mv:lands`, the Plains' own) is
        // what proves the Pin actually names a DIFFERENT Column rather than
        // a no-op re-pin of the one it is already in.
        fireEvent.click(getByRole("button", { name: "Lands" }));
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "mv:lands",
        });
    });

    it("zone moves (Pool <-> Sideboard) from the panel persist and are reflected in the Main / Sideboard counts", () => {
        const { getByTitle } = renderTable({ pool: boltInPool });
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

    // Review finding (PR #2797 round 1, HIGH): the zone-move CTA used to leave
    // `poolSelection` STALE after firing — the panel stayed open holding a
    // selection whose zone (`"maindeck"`) no longer matched reality (the card
    // was now in the Sideboard). A player who then tapped "Move to…" on that
    // stale panel reached `handlePoolPin`, which hard-codes `sideboard: false`
    // on the assumption `onPin` is only ever reachable from a Pool selection —
    // an assumption the stale selection broke, silently pulling the card back
    // OUT of the Sideboard the very next write. Asserting the panel is GONE
    // after "→ Side" is what proves the stale path is now unreachable: with
    // no open selection there is no "Move to…" CTA left to tap at all.
    it("→ Side clears the Pool selection so the panel cannot be walked into the stale-selection trap", () => {
        const { getByTitle } = renderTable({
            pool: [
                ...boltInPool,
                { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
            ],
        });
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

        // The panel — and with it, the "Move to…" CTA — is gone. There is no
        // longer a stale selection to walk into a Column pin through.
        expect(panels()).toHaveLength(0);
        expect(
            actionEls().find((el) => el.dataset.editingAction === "Move to…")
        ).toBeUndefined();

        // Nothing further was written: in particular no SECOND
        // `setPoolArrangementEntry` call reverting `sideboard` back to
        // `false` (the exact corruption the stale selection produced).
        expect(setPoolArrangementEntryMock).toHaveBeenCalledTimes(1);
    });

    // Review round 2 (PR #2797), the reason this is round 3: round 1's fix
    // above only closed the CTA door — `setPoolSelection(null)` fires from
    // the PANEL's own "→ Side"/"→ Pool" buttons, so it can only ever save a
    // player who moved the card THROUGH the panel. A Pool ⇄ Sideboard DRAG
    // is a second, independent door onto the exact same stale-selection
    // trap: `handleDragEnd` → `handleMoveArrangement` writes the Arrangement
    // directly and never touches `poolSelection` at all, so the panel stays
    // open, still reading the PRE-drag zone, with "Move to…" still offered.
    // This reproduces that exact path and proves the ROOT fix — a column pin
    // no longer asserts a Zone (`handlePoolPin`/`poolArrangementPatch`) — is
    // what makes it safe now, not a second per-door clear.
    it("a DRAG to the Sideboard, with the panel still open, does not let a follow-up 'Move to…' pin pull the card back out of the Sideboard", async () => {
        const manager = new DragDropManager();
        const { container, getByTitle, getByRole } = renderTable(
            {
                pool: [
                    ...boltInPool,
                    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
                ],
            },
            manager
        );

        // Tap-select the Bolt: opens the panel with `poolSelection.zone ===
        // "maindeck"`.
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(panels()).toHaveLength(1);

        // Drag the SAME tile into the Sideboard — NOT the panel's own "→
        // Side" CTA, so `poolSelection` never hears about the move.
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

        // The panel is STILL open, holding the now-stale "maindeck"
        // selection — the exact trap the reviewer walked.
        expect(panels()).toHaveLength(1);
        const moveTo = actionEls().find(
            (el) => el.dataset.editingAction === "Move to…"
        );
        expect(moveTo).toBeTruthy();
        fireEvent.click(moveTo!);
        fireEvent.click(getByRole("button", { name: "Lands" }));

        // The pin write must never assert a Zone: no call ever sends
        // `sideboard: false`, so the card the drag just sideboarded is not
        // silently pulled back into the Pool.
        for (const [args] of setPoolArrangementEntryMock.mock.calls) {
            expect((args as { sideboard?: boolean }).sideboard).not.toBe(false);
        }
        expect(setPoolArrangementEntryMock).toHaveBeenLastCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "mv:lands",
        });
    });

    // The Booster's own Peek Panel deliberately does NOT reserve on a phone
    // (its CTAs inline into the strip there, `draft-selection-actions.tsx`);
    // the Pool's `DeckZonePeek` opens the real FIXED panel at every viewport
    // (issue #2667 AC), so the surface underneath must reserve for it there
    // too — unlike the Booster row a few tests up, which asserts NOTHING is
    // reserved while no card is selected.
    //
    // No `matchMedia` stub here (same default the existing "reserves the
    // rail's WIDTH on desktop too" test relies on) — `useViewportMode`
    // falls back to `"desktop"`, i.e. the RAIL. This is the desktop/tablet
    // half of the pair; the phone/SHEET half is the next test.
    it("reserves the rail's WIDTH for the Pool's panel on desktop, even though the Booster's own panel never mounts here", () => {
        const { container, getByTitle } = renderTable({ pool: boltInPool });
        const surface = () =>
            container.querySelector("[data-slot=draft-surface]") as HTMLElement;
        expect(surface().style.paddingRight).toBe("");
        fireEvent.click(getByTitle(/^Remove Lightning Bolt/));
        expect(surface().style.paddingRight).toBe(PEEK_PANEL_RAIL_WIDTH);
    });

    // Review finding (PR #2797 round 1): the test above was NAMED as if it
    // covered the phone/sheet geometry issue #2667's AC actually names
    // (390x844x3 / 844x390x3), but ran with no `matchMedia` stub at all, so
    // `useViewportMode` never resolved anything but `"desktop"` — the sheet
    // reserve the AC's phone viewports depend on had evidence at NO layer.
    // Stubbed `"portrait"` the way `stubViewport` a few tests up already
    // does, this is that missing coverage: the Pool's panel is NOT
    // phone-special-cased (unlike the Booster's), so it must reserve the
    // sheet's HEIGHT in portrait exactly like the Booster panel does when IT
    // is the one open (see "reserves the sheet's HEIGHT in portrait" above).
    it("reserves the sheet's HEIGHT for the Pool's panel in portrait, even though the Booster's own panel never mounts there", () => {
        stubViewport("portrait");
        const { container, getByTitle } = renderTable({ pool: boltInPool });
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
