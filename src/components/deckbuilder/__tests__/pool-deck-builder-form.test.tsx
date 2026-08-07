// Continuous draft→build seeding tests (ADR 0060, issue #1247): "the
// Arrangement built during the draft carries unchanged into deckbuild."
// Drives `PoolDeckBuilderForm`'s initial working-deck seed for both the
// Sealed path (no Arrangement — the pre-#1247 all-Sideboard default) and the
// Draft path (an Arrangement present, even empty — the continuous
// main-by-default seed via `splitPoolByArrangement`).
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { DragDropManager } from "@dnd-kit/dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dragOnto, installDndJsdomShims } from "./dragHarness";
import { cardsIn, columnLabelsIn, paneOf } from "./zoneQueries";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

const navigate = vi.fn();
const createMock = vi.fn().mockResolvedValue("deck-1");
const useMutationMock = vi.fn();
// The Pool Arrangement sink, mocked at the HOOK rather than at `useMutation`
// so it stays distinguishable from the deck-row mutations above (every
// `useMutation` call in this file returns the same stub).
const setColumnMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: setColumnMock,
    }),
}));

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Grouping/Ordering are per-USER preferences (issue #1620's
    // `deckViewPrefs` seam), so a test that drives a control leaks its choice
    // into every LATER mount in this file — which is exactly what a fresh
    // mount is supposed to pick up. Cleared file-wide so no test's seed
    // depends on which tests ran before it.
    window.localStorage.clear();
});

// Real registry ids — the shared surface groups via the card registry.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
];

function setup() {
    // Neither `create` nor `update` fires during initial render — the exact
    // function returned doesn't matter for these seeding assertions.
    useMutationMock.mockReturnValue(createMock);
}

describe("PoolDeckBuilderForm — continuous draft→build seed (ADR 0060, issue #1247)", () => {
    it("Sealed (eventType 'sealed'): every Pool card still starts in the Sideboard — the pre-#1247 default, unchanged", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 2/)).toBeTruthy();
    });

    it("Draft with an untouched (empty) Arrangement: every Pool card is ALREADY in the Maindeck — the continuous 'Pool IS the working deck' seed", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 2/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 0/)).toBeTruthy();
    });

    it("Draft with a recorded sideboard move: the Arrangement's split carries over exactly", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[{ poolIndex: 1, sideboard: true }]}
            />
        );
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("an existingDeck always wins regardless of poolArrangement", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={{
                    kind: "user",
                    userDeckId: "deck-1" as never,
                    presetId: "deck-1",
                    name: "Saved Deck",
                    format: "limited",
                    colors: ["R"],
                    cards: [{ cardId: BOLT_ID, cardName: "Lightning Bolt" }],
                    sideboard: [{ cardId: PLAINS_ID, cardName: "Plains" }],
                    featuredCardId: null,
                    isLegal: true,
                    reasons: [],
                }}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });
});

// Draft-phase manual COLUMN arrangement carries over into the deckbuilder's
// starting layout (issue #1575 AC3) — and, because the form reads the LIVE
// seat Pool Arrangement, the same rendering is what a page reload produces
// (AC2). Bolt is MV 1 by default; the Arrangement pins it to MV 6.
describe("PoolDeckBuilderForm — draft column arrangement carry-over (issue #1575)", () => {
    it("renders a Maindeck card under the manual column its Pool Arrangement recorded, not its auto column", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[{ poolIndex: 0, column: 6 }]}
            />
        );
        const mv6 = container.querySelector(
            '[data-column="mv:6"]'
        ) as HTMLElement;
        const mv1 = container.querySelector(
            '[data-column="mv:1"]'
        ) as HTMLElement;
        expect(mv6).toBeTruthy();
        expect(within(mv6).getByTitle(/Remove Lightning Bolt/)).toBeTruthy();
        // ...and it is NOT in its auto MV 1 column.
        expect(within(mv1).queryByTitle(/Remove Lightning Bolt/)).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Per-copy Pin identity under a zone move (issue #1626, PR #2318 review B1)
// ────────────────────────────────────────────────────────────────────────────
//
// The Pin key of one physical copy must be an IDENTITY the copy carries, not a
// value re-derived on every render by counting positions in `deck.cards` — an
// array that renumbers on every Maindeck⇄Sideboard move. The first shipped
// attempt derived it as `poolIndexForCopy(pool, cardId, ordinalInZone)`, so
// sideboarding any copy of a card re-associated every REMAINING copy's Pin
// with a different physical card: the Pin silently detached from the view.
//
// Everything below drives the REAL form through the REAL shell and reads the
// REAL rendered columns — a hand-built pin map would mask exactly the
// derivation under test.
const THREE_BOLTS = [
    { scryfallId: "b1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "b2", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "b3", cardId: BOLT_ID, cardName: "Lightning Bolt" },
];

/** Tiles rendered in one Column of one pane, as clickable elements. */
function tilesIn(pane: HTMLElement, columnId: string): HTMLElement[] {
    const column = pane.querySelector(`[data-column="${columnId}"]`);
    expect(column, `no column ${columnId} rendered`).toBeTruthy();
    return [...column!.querySelectorAll("[role=button][title]")].map(
        (el) => el as HTMLElement
    );
}

describe("PoolDeckBuilderForm — per-copy Pin identity survives a zone move (issue #1626, review B1)", () => {
    it("a Pin stays with its own physical copy when a DIFFERENT copy is sideboarded", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={THREE_BOLTS}
                existingDeck={null}
                eventType="draft"
                // The THIRD Bolt (poolIndex 2) is pinned to MV 6.
                poolArrangement={[{ poolIndex: 2, pins: { mv: "mv:6" } }]}
            />
        );
        const main = () => paneOf(container, /^Maindeck/);
        expect(cardsIn(main(), "mv:6")).toHaveLength(1);
        expect(cardsIn(main(), "mv:1")).toHaveLength(2);

        // Sideboard one of the UNPINNED copies (a click on a tile sitting in
        // the auto MV 1 column).
        fireEvent.click(tilesIn(main(), "mv:1")[0]);

        expect(cardsIn(main(), "mv:1")).toHaveLength(1);
        // The pinned copy never moved, so MV 6 still holds it.
        expect(cardsIn(main(), "mv:6")).toHaveLength(1);
        expect(
            cardsIn(paneOf(container, /^Pool \(Sideboard\)/), "mv:1")
        ).toHaveLength(1);
    });

    it("sideboards the COPY that was clicked — a Pin is never re-associated with a copy that stayed", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={THREE_BOLTS}
                existingDeck={null}
                eventType="draft"
                // The SECOND Bolt (poolIndex 1) is pinned to MV 6.
                poolArrangement={[{ poolIndex: 1, pins: { mv: "mv:6" } }]}
            />
        );
        const main = () => paneOf(container, /^Maindeck/);
        expect(cardsIn(main(), "mv:6")).toHaveLength(1);

        // Click the PINNED copy: it is the one that must leave the Maindeck.
        fireEvent.click(tilesIn(main(), "mv:6")[0]);

        // MV 6 empties because the only pinned copy left the zone — no
        // surviving copy inherits its Pin.
        expect(cardsIn(main(), "mv:6")).toHaveLength(0);
        expect(cardsIn(main(), "mv:1")).toHaveLength(2);
    });

    it("re-attaches Pins to physical copies when a SAVED deck is reopened (the pinned copy is the one in the Maindeck)", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={THREE_BOLTS}
                existingDeck={{
                    kind: "user",
                    userDeckId: "deck-1" as never,
                    presetId: "deck-1",
                    name: "Saved Deck",
                    format: "limited",
                    colors: ["R"],
                    cards: [
                        { cardId: BOLT_ID, cardName: "Lightning Bolt" },
                        { cardId: BOLT_ID, cardName: "Lightning Bolt" },
                    ],
                    sideboard: [
                        { cardId: BOLT_ID, cardName: "Lightning Bolt" },
                    ],
                    featuredCardId: null,
                    isLegal: true,
                    reasons: [],
                }}
                eventType="draft"
                poolArrangement={[{ poolIndex: 2, pins: { mv: "mv:6" } }]}
            />
        );
        const main = paneOf(container, /^Maindeck/);
        // A saved deck stores card ids only, so which of the three physical
        // Bolts sits in the Maindeck is re-derived — and the derivation must
        // put the PINNED copy there, or the Pin is invisible after a reload.
        expect(cardsIn(main, "mv:6")).toHaveLength(1);
        expect(cardsIn(main, "mv:1")).toHaveLength(1);
    });
});

// Per-zone Grouping/Ordering controls (issue #1624) — the Limited builder is
// the SECOND declared variant (`DeckBuilderShell`, issue #1623), so the
// controls and the round-trip guarantee must hold here too, not only in
// Constructed.
describe("PoolDeckBuilderForm — per-zone Grouping/Ordering controls (issue #1624)", () => {
    afterEach(() => {
        window.localStorage.clear();
    });

    it("both zones carry their own Grouping and Ordering controls", () => {
        setup();
        const { getByLabelText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        expect(
            (getByLabelText("Maindeck grouping") as HTMLSelectElement).value
        ).toBe("mv");
        expect(
            (getByLabelText("Maindeck ordering") as HTMLSelectElement).value
        ).toBe("name");
        expect(
            (getByLabelText("Pool (Sideboard) grouping") as HTMLSelectElement)
                .value
        ).toBe("mv");
        expect(
            (getByLabelText("Pool (Sideboard) ordering") as HTMLSelectElement)
                .value
        ).toBe("name");
    });

    it("changing the Maindeck's Grouping leaves the Sideboard's own Grouping untouched", () => {
        setup();
        const { getByLabelText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "color" },
        });
        expect(
            (getByLabelText("Maindeck grouping") as HTMLSelectElement).value
        ).toBe("color");
        expect(
            (getByLabelText("Pool (Sideboard) grouping") as HTMLSelectElement)
                .value
        ).toBe("mv");
    });

    // The Pool Sideboard's OWN controls, driven for real (issue #1624 review
    // finding F2). "The Maindeck changed and the Sideboard did not" is
    // satisfied vacuously by a Sideboard control that does nothing at all —
    // these two are the positive half. A Sealed seat starts with every Pool
    // card in the Sideboard, which is what gives that zone cards to column.
    it("changing the SIDEBOARD's Grouping to Colour re-columns the Pool (Sideboard), leaving the Maindeck untouched", () => {
        setup();
        const { container, getByLabelText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        // Pane drop model, so only NON-EMPTY columns render: under `mv`
        // that is Lands (Plains) + MV 1 (Bolt).
        expect(
            columnLabelsIn(paneOf(container, /^Pool \(Sideboard\) /))
        ).toEqual(["Lands", "MV 1"]);

        fireEvent.change(getByLabelText("Pool (Sideboard) grouping"), {
            target: { value: "color" },
        });

        expect(
            columnLabelsIn(paneOf(container, /^Pool \(Sideboard\) /))
        ).toEqual(["Lands", "Red"]);
        expect(
            cardsIn(paneOf(container, /^Pool \(Sideboard\) /), "color:R")
        ).toEqual(["Lightning Bolt"]);

        // The Maindeck never asked for this change — still the Mana-Value
        // ladder, still its own Grouping.
        expect(
            (getByLabelText("Maindeck grouping") as HTMLSelectElement).value
        ).toBe("mv");
        expect(columnLabelsIn(paneOf(container, /^Maindeck /))).toEqual([
            "Lands",
            "MV 0",
            "MV 1",
            "MV 2",
            "MV 3",
            "MV 4",
            "MV 5",
            "MV 6",
            "MV 7+",
        ]);
    });

    it("changing the SIDEBOARD's Ordering resequences the Pool (Sideboard)'s own column", () => {
        setup();
        const { container, getByLabelText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );

        // Grouping `none` collapses the zone into its single "All" column, so
        // any resequencing observed there is the Ordering axis and nothing
        // else.
        fireEvent.change(getByLabelText("Pool (Sideboard) grouping"), {
            target: { value: "none" },
        });
        expect(
            cardsIn(paneOf(container, /^Pool \(Sideboard\) /), "all")
        ).toEqual(["Lightning Bolt", "Plains"]);

        fireEvent.change(getByLabelText("Pool (Sideboard) ordering"), {
            target: { value: "mv" },
        });

        // Same single column, same two cards — only the SEQUENCE changed
        // (Plains' Mana Value 0 sorts before Bolt's 1).
        expect(
            columnLabelsIn(paneOf(container, /^Pool \(Sideboard\) /))
        ).toEqual(["All"]);
        expect(
            cardsIn(paneOf(container, /^Pool \(Sideboard\) /), "all")
        ).toEqual(["Plains", "Lightning Bolt"]);

        // The Maindeck kept its own Ordering.
        expect(
            (getByLabelText("Maindeck ordering") as HTMLSelectElement).value
        ).toBe("name");
    });
});

// Issue #1624 review finding F1. The Maindeck is `dropModel: "columns"`, so
// every Column the Grouping control generates is a live drop target that
// highlights and accepts a drag. Before the fix, the resulting Column id was
// squeezed back through the `mv`-only legacy shim at the call site, which
// returned `undefined` for a `color:`/`type:`/`custom:` id — so the mutation
// was never called and the drop did nothing at all. This drives the whole
// path: the REAL Grouping `<select>`, the REAL surface's droppable registry,
// a REAL drag, and the REAL `handlePin` → mutation seam.
describe("PoolDeckBuilderForm — a column drag persists under EVERY Grouping (issue #1624)", () => {
    beforeAll(installDndJsdomShims);

    /** A Draft seat with an untouched Arrangement: every Pool card is already
     *  in the Maindeck, and the Sideboard is empty (so a card's tile is
     *  unambiguous by title). */
    function renderDraftSeat() {
        setup();
        const manager = new DragDropManager();
        const rendered = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
                manager={manager}
            />
        );
        return { manager, ...rendered };
    }

    it("under the default Mana-Value Grouping (the pre-#1624 path, unchanged)", async () => {
        const { manager, container, getByTitle } = renderDraftSeat();
        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="mv:6"]')!
        );
        expect(setColumnMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "mv:6",
        });
    });

    it("under Grouping Colour — the drop target the control newly made reachable", async () => {
        const { manager, container, getByTitle, getByLabelText } =
            renderDraftSeat();
        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "color" },
        });
        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="color:W"]')!
        );
        expect(setColumnMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "color:W",
        });
    });

    // Grouping `type` generates one Column per type PRESENT plus Lands, so
    // this Pool's ladder is Lands + Instant — parking Bolt in the Lands
    // Column is the cross-column move available here (column placement is
    // player organisation, not a rules statement — issue #1573).
    it("under Grouping Type", async () => {
        const { manager, container, getByTitle, getByLabelText } =
            renderDraftSeat();
        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "type" },
        });
        await dragOnto(
            manager,
            getByTitle(/Remove Lightning Bolt/),
            container.querySelector('[data-column="type:lands"]')!
        );
        expect(setColumnMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0,
            column: "type:lands",
        });
    });
});

describe("PoolDeckBuilderForm — Grouping round-trip preserves the Pool Arrangement Pin (issue #1624)", () => {
    afterEach(() => {
        window.localStorage.clear();
    });

    it("flipping Grouping to Colour and back to Mana Value keeps the Pool Arrangement's Pin exactly", () => {
        setup();
        const { container, getByLabelText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[{ poolIndex: 0, column: 6 }]}
            />
        );
        expect(
            within(container.querySelector('[data-column="mv:6"]')!).getByTitle(
                /Remove Lightning Bolt/
            )
        ).toBeTruthy();

        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "color" },
        });
        expect(
            within(
                container.querySelector('[data-column="color:R"]')!
            ).getByTitle(/Remove Lightning Bolt/)
        ).toBeTruthy();

        fireEvent.change(getByLabelText("Maindeck grouping"), {
            target: { value: "mv" },
        });
        const mv6 = container.querySelector(
            '[data-column="mv:6"]'
        ) as HTMLElement;
        const mv1 = container.querySelector(
            '[data-column="mv:1"]'
        ) as HTMLElement;
        expect(within(mv6).getByTitle(/Remove Lightning Bolt/)).toBeTruthy();
        expect(within(mv1).queryByTitle(/Remove Lightning Bolt/)).toBeNull();
    });
});

// All-five-basics-always-offered + autosave wiring (issue #1576).
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // catalogue Mountain

describe("PoolDeckBuilderForm — Add Basic bar (issue #1576)", () => {
    it("offers all five basics for a Pool with no basics at all (Vintage-Cube-style seat), adds to the Maindeck, and persists through the autosave path", async () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={[
                    {
                        scryfallId: "s1",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                ]}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );

        // All five buttons render even though the Pool opened no basics.
        for (const subtype of [
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }

        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        fireEvent.click(getByText("+ Mountain"));
        expect(getByText(/^Maindeck 1/)).toBeTruthy();

        // Unmount triggers the flush-on-unmount effect cleanup, driving the
        // debounced autosave immediately rather than waiting out the timer.
        cleanup();

        expect(createMock).toHaveBeenCalledTimes(1);
        const payload = createMock.mock.calls[0][0] as {
            cards: { cardId: string; cardName: string }[];
        };
        expect(payload.cards).toEqual([
            { cardId: MOUNTAIN_ID, cardName: "Mountain" },
        ]);
    });
});

// Issue #2056 defect 3: the route-level surface must claim the shell's
// REMAINING height (`flex-1 min-h-0`), not a whole extra viewport (`h-dvh`)
// — the shell (`app-shell.tsx`) already owns `min-h-dvh`, and stacking a
// second full-viewport claim under its header band made the document 112px
// taller than the viewport (measured at 852x303), pushing the Save bar and
// legality panel off-screen.
describe("PoolDeckBuilderForm — root surface height (issue #2056 defect 3)", () => {
    it("claims the remaining flex height (flex-1 min-h-0), never a hard h-dvh", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        const classes = root.className.split(/\s+/);
        expect(classes).toContain("flex-1");
        expect(classes).toContain("min-h-0");
        expect(classes).not.toContain("h-dvh");
    });
});

// Issue #2056 defect 2: on a short viewport (852x303 baseline, <=500px
// tall), the header band's padding and title size must shrink under the
// `short-viewport:` variant (`max-height: 500px`, defined once in
// `index.css`) so the chrome stops eating the majority of the viewport.
// jsdom doesn't evaluate media queries, so this asserts the CLASS is
// present on the right elements rather than a resolved pixel height — the
// actual "chrome <= 30% of the viewport" measurement needs a browser pass.
//
// Defect 3 AMPLIFICATION (browser-measured on this branch at 852x277,
// post-fix): shrinking the header/legality bands wasn't enough — their
// COMBINED chrome (169px) still exceeded what `<main>` had left (165px),
// so `PoolDeckbuilderSurface` (no floor, `overflow-hidden` triggers CSS's
// automatic-minimum-size-zero exception) collapsed to a measured 0px ("no
// pane has clientHeight: 0" / "at least one row of tiles" both failed).
// The header and legality bands now HIDE entirely under short-viewport
// (rather than merely shrinking) and fold into `SaveDeckBar`'s single row
// instead — see `save-deck-bar.tsx`'s `onBack`/`legality` props.
describe("PoolDeckBuilderForm — short-viewport chrome treatment (issue #2056 defects 2 & 3)", () => {
    it("the header band hides itself entirely under short-viewport — its Back affordance moves into SaveDeckBar instead of merely shrinking", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const header = container.querySelector("h1")!.parentElement!;
        expect(header.className.split(/\s+/)).toContain(
            "short-viewport:hidden"
        );
    });

    it("the legality panel band hides itself entirely under short-viewport — its content moves into SaveDeckBar's compact chip instead", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const legalityBand =
            container.querySelector('[role="status"]')!.parentElement!;
        expect(legalityBand.className.split(/\s+/)).toContain(
            "short-viewport:hidden"
        );
    });

    it("SaveDeckBar's row carries a short-viewport-only Back button and legality chip so the two hidden bands' functionality survives", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const form = container.querySelector("form")!;
        const backButtons = within(form).getAllByText("← Back to Event");
        const shortViewportBack = backButtons.find((el) =>
            el.className.split(/\s+/).includes("short-viewport:inline-flex")
        );
        expect(shortViewportBack).toBeTruthy();

        const chipWrapper = form.querySelector(
            "span.hidden.short-viewport\\:inline-flex"
        );
        expect(chipWrapper).toBeTruthy();
    });

    it("PoolDeckbuilderSurface keeps a min-height floor tied to the SAME floored card size defect 1 fixed, so it cannot collapse to 0", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const surfaceRoot = container.querySelector(
            '[style*="--card-base"]'
        ) as HTMLElement;
        expect(surfaceRoot).toBeTruthy();
        // jsdom's CSSOM (`cssstyle`) doesn't round-trip a `calc()` nesting
        // `min()`/`max()` faithfully — it numerically folds the `* 7 / 5`
        // term and mangles the inner min()/max() commas on read-back, which
        // is a jsdom parsing limitation, not a real-browser one. Assert only
        // that SOME non-empty min-height made it onto the element (the thing
        // that matters for "does not collapse") here; the exact expression
        // is pinned as a source-text assertion below instead, following the
        // same jsdom-can't-verify-this precedent as `deck-builder-height.test.ts`.
        expect(surfaceRoot.style.minHeight).not.toBe("");
    });
});

// jsdom's CSSOM mangles a `calc()` that nests `min()`/`max()` on read-back
// (see the test above), so the exact minHeight expression is pinned here as
// a source-text assertion instead — legitimate per the same
// jsdom-can't-verify-this precedent `deck-builder-height.test.ts` documents.
describe("DeckBuilderShell — builder pane floor (issue #2056 defect 3 amplification)", () => {
    it("the min-height expression is tied to the variant's declared card base (the SAME floored card size defect 1 fixed), not a second unrelated hardcoded number", () => {
        // Issue #1623 absorbed `pool-deckbuilder-surface.tsx` into the shared
        // `DeckBuilderShell`, so the floor now derives from the view spec the
        // variant declares (`view.cardBase`) rather than a per-surface const.
        const src = readFileSync(
            join(__dirname, "..", "deck-builder-shell.tsx"),
            "utf8"
        );
        expect(src).toContain(
            "minHeight: `calc(${view.cardBase} * 7 / 5 + 3.5rem)`"
        );
    });
});

// Issue #2056 defect 1: the responsive card-size clamp must carry the
// CARD_MIN_W floor (via `cardBase()`), or a short-and-wide viewport (the
// `dvh` term binding) collapses tiles below legibility (measured 27.3px at
// 852x303). This asserts the emitted `--card-base` CSS var — the thing
// `--card-w`/`--card-h` are computed from — carries the floor, since jsdom
// can't measure a resolved pixel width. Moved here from the retired
// `pool-deckbuilder-surface.test.tsx` (issue #1623): the constant is this
// VARIANT's, so the guard belongs where the variant is mounted.
describe("PoolDeckBuilderForm — card-size floor (issue #2056, unchanged by #2275)", () => {
    it("emits the same --card-base clamp as issue #2056 shipped — wrapped in a max() floor, not a bare min()", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const surfaceRoot = container.querySelector(
            '[style*="--card-base"]'
        ) as HTMLElement;
        expect(surfaceRoot.style.getPropertyValue("--card-base")).toBe(
            "max(4.5rem, min(7.5rem, 17vw, 9dvh))"
        );
    });
});

// Issue #2275: below 800px of viewport height, `PoolDeckbuilderSurface`'s
// own `minHeight` is a CONSTANT (156.8px, `poolSurfaceMinHeightPx()` in
// `~/lib/cardSizing.ts` proves the math — see `deck-builder-height.test.ts`)
// while the space `<main>` (the shell) actually has left for this route
// keeps shrinking with the viewport. Below ~246px that constant used to win,
// and since nothing absorbed the shortfall except `<main>`'s own fallback
// scrollbar, `SaveDeckBar` — the primary Done action — spilled past the
// bottom of the viewport, exactly the symptom the #2056 fix removed at
// taller viewports.
//
// Chosen fix (branch (b) from the issue): PIN `SaveDeckBar`. Everything that
// can outgrow its box — the header, the basics bar, and above all the pane
// carrying the forced floor — now lives inside its OWN `overflow-y-auto`
// wrapper; `SaveDeckBar` is a plain sibling flex item OUTSIDE it. This is
// deliberately NOT a fix that only holds above/below some specific pixel
// value: it is a structural invariant (a flex sibling outside a `min-h-0
// flex-1 overflow-y-auto` wrapper always renders at its own natural height,
// regardless of how much the wrapper's content overflows), so it holds at
// EVERY viewport height the app supports — jsdom cannot run real layout to
// prove a number, but it CAN prove the DOM shape that makes the number
// irrelevant, which is what this sweep asserts once at each representative
// height band (down to 64px — well under any real device, past which no
// fix restores usability; through the issue's own ~246px measurement; up
// past the 800px floor-vs-scaling boundary `deck-builder-height.test.ts`
// exercises numerically). The fallback-scroll crossover — the height below
// which the WRAPPER now needs its own scrollbar to show the whole pane,
// where before this fix the deficit spilled onto `SaveDeckBar` instead — is
// unchanged from the issue's own ~246px measurement: the pane's floor and
// the surrounding chrome are both untouched by this fix, only what absorbs
// the shortfall is different.
describe("PoolDeckBuilderForm — SaveDeckBar stays reachable regardless of the pane's forced floor (issue #2275)", () => {
    // Height is not an input this component reads (no windowed media-query
    // JS, no ResizeObserver) — the `short-viewport:` variant is a pure CSS
    // media query jsdom never evaluates. So "sweeping viewport heights"
    // here means: at every height in the band, the SAME rendered DOM shape
    // applies, and that shape is what the assertions below pin. There is
    // nothing further to vary per height because the component's output is
    // height-invariant by design — that invariance IS the fix.
    const REPRESENTATIVE_HEIGHTS_PX = [
        64, 150, 200, 245, 246, 247, 300, 500, 800, 1200,
    ];

    it.each(REPRESENTATIVE_HEIGHTS_PX)(
        "at a %ipx-tall viewport, SaveDeckBar's form is NOT inside the pane's scrollable wrapper",
        () => {
            setup();
            const { container } = render(
                <PoolDeckBuilderForm
                    eventId={"event-1" as never}
                    seatIndex={0}
                    pool={POOL}
                    existingDeck={null}
                    eventType="sealed"
                    poolArrangement={[]}
                />
            );
            const form = container.querySelector("form")!;
            const scrollWrapper = container.querySelector(".overflow-y-auto")!;
            expect(scrollWrapper).toBeTruthy();
            expect(scrollWrapper.contains(form)).toBe(false);
            cleanup();
        }
    );

    it("the scrollable wrapper contains the pane carrying the forced min-height floor, so its shortfall is absorbed there instead of pushing SaveDeckBar out of the flex column", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const surfaceRoot = container.querySelector('[style*="--card-base"]')!;
        const scrollWrapper = container.querySelector(".overflow-y-auto")!;
        expect(scrollWrapper.contains(surfaceRoot)).toBe(true);
    });

    it("SaveDeckBar's own wrapper is a shrink-0 sibling of the scrollable wrapper — it never competes for the pane's shortfall", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const form = container.querySelector("form")!;
        const saveBarWrapper = form.parentElement!;
        expect(saveBarWrapper.className.split(/\s+/)).toContain("shrink-0");
        const root = container.firstElementChild as HTMLElement;
        expect(Array.from(root.children)).toContain(saveBarWrapper);
    });
});
